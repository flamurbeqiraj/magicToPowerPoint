<script lang="ts">
  import { onMount } from 'svelte';
  import MiniSlide from './MiniSlide.svelte';
  import { generate, listOllamaModels } from './lib/providers';
  import { clone, SLIDE_HEIGHT, SLIDE_WIDTH, validatePresentation, type Presentation, type ProviderKind, type ProviderSettings, type Slide, type SlideElement, type TextElement, type OidcSettings } from './lib/model';
  import { downloadSlide, renderSlide, slideSvgBlob, slideSvgMarkup } from './lib/svg';
  import { ArrowLeft, Check, ChevronDown, ChevronRight, Copy, Download, GripVertical, Layers, LoaderCircle, Plus, Redo2, Settings2, Sparkles, Trash2, Undo2, X } from '@lucide/svelte';

  const STORAGE_KEY = 'studio.presentation.v1';
  const OLLAMA_DEFAULT: ProviderSettings = { kind:'ollama', baseUrl:'http://localhost:11434', model:'qwen3:8b', manualAccessToken:'', authorizationSource:'manual', temperature:0.72 };
  const REMOTE_DEFAULT: ProviderSettings = { kind:'openai-compatible', baseUrl:'https://api.openai.com/v1', model:'gpt-4o-mini', manualAccessToken:'', authorizationSource:'manual', temperature:0.72 };
  const DEFAULT_BRIEF = 'Create a modern presentation about how artificial intelligence is changing software development. Explain coding, testing, documentation and developer productivity. Use a sophisticated dark navy design with electric blue and violet accents.';
  const styleChoices = ['Modern / Professional', 'Editorial', 'Minimal', 'Bold & expressive', 'Playful', 'Futuristic'];

  let brief = '';
  let slideCount = 5;
  let style = styleChoices[0];
  let styleNotes = '';
  let primaryColor = '#8b7cff';
  let providerKind: ProviderKind = 'ollama';
  let settingsByKind: Record<ProviderKind, ProviderSettings> = { ollama:clone(OLLAMA_DEFAULT), 'openai-compatible':clone(REMOTE_DEFAULT) };
  let oidc: OidcSettings = { issuer:'', clientId:'', redirectUri:'', scopes:'openid profile email', enabled:false };
  let ollamaModels: string[] = [];
  let listingModels = false;
  let settingsOpen = false;
  let oidcSection = false;
  let presentation: Presentation | null = null;
  let inEditor = false;
  let activeSlide = 0;
  let selectedElement: number | null = null;
  let stageSvg: SVGSVGElement;
  let promptInput = '';
  let generating = false;
  let generationMode: 'deck' | 'slide' | 'instruction' = 'deck';
  let generationPhase = 0;
  let progressTimer: ReturnType<typeof setInterval>;
  let inlineEditing: number | null = null;
  let editingText = '';
  let titleAtEditStart = '';
  let toast = '';
  let toastTimer: ReturnType<typeof setTimeout>;
  let persistenceTimer: ReturnType<typeof setTimeout>;
  let hydrated = false;
  let undoStack: Presentation[] = [];
  let redoStack: Presentation[] = [];
  let dragSlideIndex: number | null = null;
  let gesture: { index:number; resizing:boolean; startX:number; startY:number; scaleX:number; scaleY:number; element:SlideElement } | null = null;

  let draftJson = '';

  $: settings = settingsByKind[providerKind];
  $: slide = presentation?.slides[activeSlide] ?? null;
  $: selected = selectedElement !== null ? slide?.elements[selectedElement] ?? null : null;
  $: generationMessages = generationMode === 'deck'
    ? ['Planning your story', 'Finding the right visual rhythm', 'Designing your slides', 'Polishing the details']
    : generationMode === 'slide' ? ['Reworking the composition', 'Matching the deck’s design system', 'Refining slide content', 'Finishing touches']
      : ['Understanding your direction', 'Updating the design', 'Rebalancing the composition', 'Applying changes'];
  $: if (stageSvg && presentation && inEditor && slide) renderSlide(stageSvg, slide, presentation, { selectedIndex:selectedElement ?? undefined });
  $: draftJson = hydrated ? JSON.stringify({
    presentation, brief, slideCount, style, styleNotes, primaryColor, providerKind,
    providers:{
      ollama:{ baseUrl:persistableBaseUrl(settingsByKind.ollama.baseUrl), model:settingsByKind.ollama.model, temperature:settingsByKind.ollama.temperature },
      'openai-compatible':{ baseUrl:persistableBaseUrl(settingsByKind['openai-compatible'].baseUrl), model:settingsByKind['openai-compatible'].model, temperature:settingsByKind['openai-compatible'].temperature }
    }, oidc
  }) : '';
  $: if (draftJson) scheduleDraftSave(draftJson);

  onMount(() => {
    hydrateDraft();


    void refreshModels(false);
    return () => { clearTimeout(toastTimer); clearTimeout(persistenceTimer); clearInterval(progressTimer); };
  });

  function scheduleDraftSave(snapshot: string): void {
    clearTimeout(persistenceTimer);
    persistenceTimer = setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, snapshot); } catch { /* storage may be disabled or full */ } }, 350);
  }
  function saveDraftNow(): void {
    clearTimeout(persistenceTimer);
    if (draftJson) { try { localStorage.setItem(STORAGE_KEY, draftJson); } catch { /* storage may be disabled or full */ } }
  }
  function persistableBaseUrl(value: string): string {
    try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.toString().replace(/\/$/, ''); }
    catch { return value.replace(/[?#].*$/, '').replace(/\/\/[^/@]+@/, '//').replace(/\/$/, ''); }
  }

  function hydrateDraft(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { presentation?:Presentation; brief?:string; slideCount?:number; style?:string; styleNotes?:string; primaryColor?:string; providerKind?:ProviderKind; providers?:Partial<Record<ProviderKind,Partial<ProviderSettings>>>; oidc?:Partial<OidcSettings> };
        if (saved.presentation?.slides?.length) {
          presentation = validatePresentation({ presentation:saved.presentation }, saved.presentation.slides.length).presentation;
          inEditor = true; activeSlide = 0;
        }
        brief = saved.brief === DEFAULT_BRIEF ? '' : saved.brief ?? ''; slideCount = saved.slideCount || 5; style = saved.style || style; styleNotes = saved.styleNotes || ''; primaryColor = saved.primaryColor || primaryColor;
        if (saved.providerKind) providerKind = saved.providerKind;
        for (const kind of ['ollama','openai-compatible'] as ProviderKind[]) {
          const persisted = saved.providers?.[kind];
          if (persisted) settingsByKind[kind] = { ...settingsByKind[kind], ...persisted, manualAccessToken:'' };
        }
        if (saved.oidc) oidc = { ...oidc, ...saved.oidc };
      }
    } catch { /* ignore an old or damaged local draft */ }
    hydrated = true;
  }

  function announce(message: string): void {
    toast = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast = '', 3800);
  }

  async function refreshModels(showMessage = true): Promise<void> {
    if (providerKind !== 'ollama') { if (showMessage) announce('Model discovery is available for Ollama.'); return; }
    listingModels = true;
    try {
      ollamaModels = await listOllamaModels(settingsByKind.ollama.baseUrl);
      if (ollamaModels.length) {
        const selectedModel = settingsByKind.ollama.model;
        if (!ollamaModels.includes(selectedModel)) settingsByKind.ollama.model = ollamaModels[0];
        if (showMessage) announce(`Found ${ollamaModels.length} local model${ollamaModels.length === 1 ? '' : 's'}.`);
      } else if (showMessage) announce('No Ollama models found. Pull a model, then refresh.');
    } catch (error) { if (showMessage) announce(error instanceof Error ? error.message : 'Could not list Ollama models.'); }
    finally { listingModels = false; }
  }

  function currentSettings(): ProviderSettings { return { ...settingsByKind[providerKind] }; }
  function beginProgress(mode: typeof generationMode): void {
    generationMode = mode; generating = true; generationPhase = 0;
    clearInterval(progressTimer);
    progressTimer = setInterval(() => generationPhase = Math.min(generationPhase + 1, 3), 1450);
  }
  function endProgress(): void { clearInterval(progressTimer); generating = false; }
  function pushHistory(): void {
    if (!presentation) return;
    undoStack = [...undoStack.slice(-79), clone(presentation)]; redoStack = [];
  }
  function copyActiveSlide(): Presentation | null {
    if (!presentation) return null;
    const next = { ...presentation, slides:[...presentation.slides] };
    next.slides[activeSlide] = { ...presentation.slides[activeSlide], elements:[...presentation.slides[activeSlide].elements] };
    return next;
  }

  async function generateDeck(): Promise<void> {
    if (!brief.trim()) { announce('Add a short description of what you want to present.'); return; }
    slideCount = Math.round(Number(slideCount));
    if (!Number.isFinite(slideCount) || slideCount < 1 || slideCount > 20) { announce('Choose between 1 and 20 slides.'); return; }
    beginProgress('deck');
    try {
      const next = await generate({ brief:brief.trim(), slides:slideCount, style, styleNotes, primaryColor }, currentSettings());
      presentation = next; brief = brief.trim(); inEditor = true; activeSlide = 0; selectedElement = null;
      undoStack = []; redoStack = []; announce(`${next.slides.length} slides ready. Your presentation is saved on this device.`);
    } catch (error) { announce(error instanceof Error ? error.message : 'The presentation could not be generated. Try again.'); }
    finally { endProgress(); }
  }

  async function regenerateCurrentSlide(): Promise<void> {
    if (!presentation) return;
    const source = clone(presentation); const targetId = source.slides[activeSlide].id;
    beginProgress('slide');
    try {
      const result = await generate({ brief, slides:source.slides.length, style, styleNotes, primaryColor:source.theme.primary, current:source, slideIndex:activeSlide, instruction:promptInput.trim() || 'Refresh this slide with clearer visual storytelling.' }, currentSettings());
      const targetIndex = presentation.slides.findIndex(item => item.id === targetId);
      if (targetIndex < 0 || JSON.stringify(presentation.slides[targetIndex]) !== JSON.stringify(source.slides[activeSlide])) { announce('This slide changed while the redesign was running. Run the instruction again to use the latest version.'); return; }
      pushHistory(); presentation.slides[targetIndex] = { ...result.slides[0], id:targetId };
      presentation = { ...presentation, slides:[...presentation.slides] }; selectedElement = null; promptInput = '';
      announce('Slide updated.');
    } catch (error) { announce(error instanceof Error ? error.message : 'This slide could not be regenerated.'); }
    finally { endProgress(); }
  }

  async function sendInstruction(): Promise<void> {
    if (!presentation || !promptInput.trim()) { announce('Write an instruction first.'); return; }
    const instruction = promptInput.trim();
    const sourceSnapshot = clone(presentation);
    const wholeDeck = /\b(whole|entire|all|every)\s+(presentation|deck|slides?)\b|\bacross the deck\b|\btheme\b|\baccent color\b/i.test(instruction);
    const selectedOnly = selectedElement !== null && /\b(selected|selection|these elements|this element)\b/i.test(instruction);
    if (wholeDeck) {
      beginProgress('instruction');
      try {
        const result = await generate({ brief, slides:sourceSnapshot.slides.length, style, styleNotes, primaryColor:sourceSnapshot.theme.primary, current:sourceSnapshot, instruction }, currentSettings());
        if (JSON.stringify(presentation) !== JSON.stringify(sourceSnapshot)) { announce('The presentation changed while the designer was working. Run the instruction again to include those edits.'); return; }
        if (JSON.stringify(result) === JSON.stringify(sourceSnapshot)) { announce('The model returned no changes. Try a more specific instruction.'); return; }
        pushHistory(); presentation = result; activeSlide = Math.min(activeSlide, result.slides.length - 1); selectedElement = null; promptInput = ''; announce('Presentation updated.');
      } catch (error) { announce(error instanceof Error ? error.message : 'The instruction could not be applied.'); }
      finally { endProgress(); }
      return;
    }
    beginProgress('slide');
    try {
      const targetId = sourceSnapshot.slides[activeSlide].id;
      const original = clone(sourceSnapshot.slides[activeSlide]);
      const selectionIndices = selectedOnly ? [selectedElement!] : [];
      const result = await generate({ brief, slides:sourceSnapshot.slides.length, style, styleNotes, primaryColor:sourceSnapshot.theme.primary, current:sourceSnapshot,
        slideIndex:activeSlide, instruction, selectedElements:selectionIndices.map(index => original.elements[index]) }, currentSettings());
      const targetIndex = presentation.slides.findIndex(item => item.id === targetId);
      if (targetIndex < 0 || JSON.stringify(presentation.slides[targetIndex]) !== JSON.stringify(original)) { announce('This slide changed while the designer was working. Run the instruction again to include those edits.'); return; }
      pushHistory(); const generated = result.slides[0];
      let replacement: Slide;
      if (selectedOnly) {
        const elements = [...original.elements];
        for (const index of selectionIndices) if (generated.elements[index]) elements[index] = generated.elements[index];
        replacement = { ...original, elements };
      } else replacement = { ...generated, id:original.id };
      if (JSON.stringify(replacement) === JSON.stringify(original)) { announce('The model returned no changes. Try a more specific instruction.'); return; }
      presentation.slides[targetIndex] = replacement; presentation = { ...presentation, slides:[...presentation.slides] };
      selectedElement = selectedOnly ? selectedElement : null; promptInput = ''; announce(selectedOnly ? 'Selected element updated.' : 'Slide updated.');
    } catch (error) { announce(error instanceof Error ? error.message : 'The instruction could not be applied.'); }
    finally { endProgress(); }
  }

  function setActive(index: number): void { activeSlide = Math.max(0, Math.min(index, (presentation?.slides.length ?? 1) - 1)); selectedElement = null; inlineEditing = null; }
  function updateElement(index: number, key: string, value: unknown): void {
    if (!presentation || !slide) return;
    const next = copyActiveSlide()!; const item = { ...next.slides[activeSlide].elements[index] } as unknown as Record<string, unknown>;
    const numeric = ['x','y','width','height','fontSize','fontWeight','opacity','rotation','letterSpacing','strokeWidth','radius','borderRadius','lineSpacing'].includes(key);
    if (numeric) {
      const proposed = Number(value); if (!Number.isFinite(proposed)) return;
      const bounds:Record<string,[number,number]> = {x:[-1280,2560],y:[-720,1440],width:[0,2560],height:[0,1440],fontSize:[8,180],fontWeight:[100,900],opacity:[0,1],rotation:[-360,360],letterSpacing:[-4,24],strokeWidth:[0,40],radius:[0,160],borderRadius:[0,180],lineSpacing:[1,3]};
      let maximum = bounds[key][1];
      if (key === 'fontSize' && item.type === 'bulletList') maximum = 80;
      if (key === 'strokeWidth' && item.type !== 'line') maximum = 32;
      item[key] = Math.min(maximum,Math.max(bounds[key][0],proposed));
    } else if (key === 'text') item[key] = String(value).slice(0,1400);
    else if (key === 'items' && Array.isArray(value)) item[key] = value.slice(0,12).map(entry => String(entry).slice(0,220));
    else item[key] = value;
    pushHistory();
    next.slides[activeSlide].elements[index] = item as unknown as SlideElement;
    presentation = next;
  }
  function addText(): void {
    if (!presentation || !slide) return;
    if (slide.elements.length >= 80) { announce('This slide has reached the 80 element limit.'); return; }
    pushHistory();
    const element: TextElement = { type:'text', text:'Your new headline', x:130, y:270, width:720, height:110, fontSize:48, fontWeight:700, fontFamily:presentation.theme.fontFamily, color:presentation.theme.textPrimary, align:'left', verticalAlign:'middle', opacity:1, rotation:0, letterSpacing:0 };
    const next = copyActiveSlide()!; next.slides[activeSlide].elements.push(element); presentation = next; selectedElement = next.slides[activeSlide].elements.length - 1;
    beginInlineEdit(selectedElement);
  }
  function addShape(): void {
    if (!presentation || !slide) return;
    if (slide.elements.length >= 80) { announce('This slide has reached the 80 element limit.'); return; }
    pushHistory(); const next = copyActiveSlide()!;
    next.slides[activeSlide].elements.push({ type:'roundedRectangle', x:180, y:240, width:280, height:170, fill:presentation.theme.surface, stroke:presentation.theme.primary, strokeWidth:2, radius:24, opacity:1, rotation:0 });
    presentation = next; selectedElement = next.slides[activeSlide].elements.length - 1;
  }
  function addSlide(): void {
    if (!presentation) return;
    if (presentation.slides.length >= 30) { announce('This presentation has reached the 30 slide limit.'); return; }
    pushHistory(); const index = presentation.slides.length + 1;
    const next = clone(presentation); next.slides.push({ id:`slide-${crypto.randomUUID()}`, layout:'New slide', elements:[
      { type:'text', text:`A new idea`, x:100, y:82, width:840, height:86, fontSize:48, fontWeight:700, fontFamily:presentation.theme.fontFamily, color:presentation.theme.textPrimary, align:'left', verticalAlign:'middle', opacity:1, rotation:0, letterSpacing:-1 },
      { type:'text', text:'Double-click to add your perspective', x:104, y:190, width:730, height:70, fontSize:25, fontWeight:400, fontFamily:presentation.theme.fontFamily, color:presentation.theme.textSecondary, align:'left', verticalAlign:'top', opacity:1, rotation:0, letterSpacing:0 }
    ] }); presentation = next; setActive(index - 1);
  }
  function duplicateSlide(index: number): void {
    if (!presentation) return;
    if (presentation.slides.length >= 30) { announce('This presentation has reached the 30 slide limit.'); return; }
    pushHistory(); const next = clone(presentation); const duplicated = clone(next.slides[index]); duplicated.id = `slide-${crypto.randomUUID()}`;
    next.slides.splice(index + 1, 0, duplicated); presentation = next; setActive(index + 1);
  }
  function deleteSlide(index: number): void {
    if (!presentation || presentation.slides.length < 2) { announce('A presentation needs at least one slide.'); return; }
    pushHistory(); const next = clone(presentation); next.slides.splice(index, 1); presentation = next; setActive(Math.min(index, next.slides.length - 1));
  }
  function reorderSlide(targetIndex: number): void {
    if (!presentation || dragSlideIndex === null || dragSlideIndex === targetIndex) return;
    pushHistory(); const next = clone(presentation); const [moving] = next.slides.splice(dragSlideIndex, 1); next.slides.splice(targetIndex, 0, moving); presentation = next;
    if (activeSlide === dragSlideIndex) activeSlide = targetIndex;
    else if (dragSlideIndex < activeSlide && targetIndex >= activeSlide) activeSlide--;
    else if (dragSlideIndex > activeSlide && targetIndex <= activeSlide) activeSlide++;
    dragSlideIndex = null;
  }
  function changeLayer(index: number, direction: -1 | 1): void {
    if (!presentation || !slide) return;
    const nextIndex = Math.max(0, Math.min(slide.elements.length - 1, index + direction));
    if (nextIndex === index) return;
    pushHistory(); const next = clone(presentation); const [item] = next.slides[activeSlide].elements.splice(index, 1); next.slides[activeSlide].elements.splice(nextIndex, 0, item);
    presentation = next; selectedElement = nextIndex;
  }
  function removeSelected(): void {
    if (!presentation || !slide || selectedElement === null) return;
    pushHistory(); const next = copyActiveSlide()!; next.slides[activeSlide].elements.splice(selectedElement, 1); presentation = next; selectedElement = null;
  }
  function undo(): void {
    if (!presentation || !undoStack.length) return;
    redoStack = [...redoStack, clone(presentation)]; presentation = undoStack.at(-1)!; undoStack = undoStack.slice(0, -1); selectedElement = null;
  }
  function redo(): void {
    if (!presentation || !redoStack.length) return;
    undoStack = [...undoStack, clone(presentation)]; presentation = redoStack.at(-1)!; redoStack = redoStack.slice(0, -1); selectedElement = null;
  }
  function beginInlineEdit(index: number): void {
    if (!slide || slide.elements[index]?.type !== 'text') return;
    selectedElement = index; inlineEditing = index; editingText = (slide.elements[index] as TextElement).text;
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.inline-editor')?.focus());
  }
  function finishInlineEdit(commit: boolean): void {
    if (inlineEditing === null || !presentation) return;
    if (commit && slide?.elements[inlineEditing]?.type === 'text') {
      updateElement(inlineEditing, 'text', editingText);
    }
    inlineEditing = null;
  }
  function handlePointerDown(event: PointerEvent): void {
    if (!presentation || !stageSvg) return;
    const target = event.target as Element;
    const resizeHandle = target.closest('[data-resize-index]');
    const item = target.closest('[data-element-index]');
    if (!item) { selectedElement = null; return; }
    const index = Number((resizeHandle || item).getAttribute(resizeHandle ? 'data-resize-index' : 'data-element-index'));
    if (!Number.isInteger(index) || index < 0 || !slide?.elements[index]) return;
    inlineEditing = null; selectedElement = index;
    const box = stageSvg.getBoundingClientRect(); const widthScale = box.width / SLIDE_WIDTH; const heightScale = box.height / SLIDE_HEIGHT;
    gesture = { index, resizing:Boolean(resizeHandle), startX:event.clientX, startY:event.clientY, scaleX:widthScale, scaleY:heightScale, element:clone(slide.elements[index]) };
    stageSvg.setPointerCapture(event.pointerId);
    pushHistory(); event.preventDefault();
  }
  function handlePointerMove(event: PointerEvent): void {
    if (!gesture || !presentation) return;
    const dx = (event.clientX - gesture.startX) / gesture.scaleX, dy = (event.clientY - gesture.startY) / gesture.scaleY;
    const next = clone(presentation); const item = next.slides[activeSlide].elements[gesture.index];
    if (gesture.resizing) {
      if (item.type !== 'line' && gesture.element.type !== 'line') {
        item.width = Math.min(2560, Math.max(24, gesture.element.width + dx));
        item.height = Math.min(1440, Math.max(24, gesture.element.height + dy));
      }
    } else if (item.type === 'line' && gesture.element.type === 'line') {
      const clampX = (value: number) => Math.min(2560, Math.max(-1280, value));
      const clampY = (value: number) => Math.min(1440, Math.max(-720, value));
      item.x1 = clampX(gesture.element.x1 + dx); item.y1 = clampY(gesture.element.y1 + dy);
      item.x2 = clampX(gesture.element.x2 + dx); item.y2 = clampY(gesture.element.y2 + dy);
    } else if (item.type !== 'line' && gesture.element.type !== 'line') {
      item.x = Math.min(2560, Math.max(-1280, gesture.element.x + dx));
      item.y = Math.min(1440, Math.max(-720, gesture.element.y + dy));
    }
    presentation = next;
  }
  function handlePointerUp(): void { gesture = null; }
  function handleDoubleClick(event: MouseEvent): void {
    const target = event.target as Element; const group = target.closest('[data-element-index]');
    if (!group) return;
    const index = Number(group.getAttribute('data-element-index'));
    if (slide?.elements[index]?.type === 'text') beginInlineEdit(index);
  }
  function handleKeydown(event: KeyboardEvent): void {
    if (settingsOpen && event.key === 'Escape') { settingsOpen = false; return; }
    const target = event.target as HTMLElement | null;
    const editing = target && (['INPUT','TEXTAREA','SELECT'].includes(target.tagName) || target.isContentEditable);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    else if (!editing && (event.key === 'Delete' || event.key === 'Backspace') && selectedElement !== null && inEditor) { event.preventDefault(); removeSelected(); }
    else if (!editing && event.key === 'Escape') { selectedElement = null; inlineEditing = null; }
    else if (!editing && event.key === 'ArrowDown' && inEditor) { event.preventDefault(); setActive(activeSlide + 1); }
    else if (!editing && event.key === 'ArrowUp' && inEditor) { event.preventDefault(); setActive(activeSlide - 1); }
  }

  async function copySlide(): Promise<void> {
    if (!stageSvg || !presentation || !slide) return;
    const cleanSvg = document.createElementNS('http://www.w3.org/2000/svg','svg'); renderSlide(cleanSvg, slide, presentation);
    try {
      const blob = slideSvgBlob(cleanSvg);
      if (navigator.clipboard?.write && 'ClipboardItem' in window) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/svg+xml':blob })]); announce('SVG slide copied. Paste it into PowerPoint.'); return;
      }
      throw new Error('SVG clipboard writing is unavailable.');
    } catch {
      try {
        const xml = slideSvgMarkup(cleanSvg);
        await navigator.clipboard.writeText(xml); announce('SVG markup copied. Use Download SVG to insert the slide as an image.');
      } catch { announce('Clipboard access is unavailable here. Download the SVG and insert it into PowerPoint.'); }
    }
  }
  async function copySvgMarkup(): Promise<void> {
    if (!stageSvg || !presentation || !slide) return;
    const cleanSvg = document.createElementNS('http://www.w3.org/2000/svg','svg'); renderSlide(cleanSvg, slide, presentation);
    try { await navigator.clipboard.writeText(slideSvgMarkup(cleanSvg)); announce('SVG source copied to the clipboard.'); }
    catch { announce('Clipboard access is unavailable in this browser.'); }
  }
  function downloadCurrent(): void {
    if (!stageSvg || !presentation || !slide) return;
    const cleanSvg = document.createElementNS('http://www.w3.org/2000/svg','svg'); renderSlide(cleanSvg, slide, presentation);
    downloadSlide(cleanSvg, `slide-${String(activeSlide+1).padStart(2,'0')}`);
  }
  function selectProvider(kind: ProviderKind): void { providerKind = kind; if (kind === 'ollama') void refreshModels(false); }
  function normalizeBaseUrl(kind: ProviderKind): void {
    const current = settingsByKind[kind].baseUrl.trim();
    try { const url = new URL(current); url.search = ''; url.hash = ''; url.username = ''; url.password = ''; settingsByKind[kind].baseUrl = url.toString().replace(/\/$/, ''); }
    catch { settingsByKind[kind].baseUrl = current.replace(/[?#].*$/, '').replace(/\/$/, ''); }
  }
  function updateTitle(event: Event): void { if (presentation) presentation = { ...presentation, title:(event.currentTarget as HTMLInputElement).value.slice(0,140) }; }
  function finishTitleEdit(): void {
    if (!presentation || !titleAtEditStart || titleAtEditStart === presentation.title) return;
    const previous = clone(presentation); previous.title = titleAtEditStart;
    undoStack = [...undoStack.slice(-79), previous]; redoStack = []; titleAtEditStart = '';
  }

  function itemLabel(layout: string | undefined, index: number): string { return (layout || `Slide ${String(index+1).padStart(2,'0')}`).toUpperCase(); }
</script>

<svelte:window onkeydown={handleKeydown} onpointerup={handlePointerUp} onbeforeunload={saveDraftNow} />

{#if !inEditor}
  <main class="landing landing-simple">
    <section class="create-page" aria-labelledby="create-title">
      <header class="create-header">
        <h1 id="create-title">Create a presentation</h1>
        <p>Describe what you want to present, then choose how to run the AI.</p>
      </header>

      <form class="prompt-card simple-prompt-card" onsubmit={(event) => { event.preventDefault(); void generateDeck(); }}>
        <div class="form-field brief-field">
          <label class="form-label" for="brief">What is your presentation about?</label>
          <textarea class="brief-input" id="brief" bind:value={brief} maxlength="1800" placeholder="Example: Explain how AI is changing software development for an audience of software engineers." rows="5"></textarea>
        </div>

        <div class="form-basics">
          <label class="form-field slide-count-field" for="slide-count">
            <span class="form-label">Number of slides</span>
            <input id="slide-count" type="number" min="1" max="20" bind:value={slideCount}/>
          </label>
          <span class="field-hint">Choose 1 to 20 slides</span>
        </div>

        <details class="advanced-options">
          <summary>Optional style settings</summary>
          <div class="advanced-fields">
            <label class="form-field" for="style-choice">
              <span class="form-label">Design style</span>
              <select id="style-choice" bind:value={style}>{#each styleChoices as choice}<option>{choice}</option>{/each}</select>
            </label>
            <label class="form-field style-notes-field" for="style-notes">
              <span class="form-label">Extra design notes</span>
              <input id="style-notes" bind:value={styleNotes} maxlength="400" placeholder="Mood, tone, or brand direction (optional)"/>
            </label>
            <label class="form-field accent-field" for="accent-color">
              <span class="form-label">Accent color</span>
              <span class="accent-control"><input id="accent-color" type="color" bind:value={primaryColor}/><span>{primaryColor}</span></span>
            </label>
          </div>
        </details>

        <fieldset class="provider-picker">
          <legend>Choose an AI provider</legend>
          <div class="provider-options">
            <button type="button" class="provider-option" class:provider-active={providerKind === 'ollama'} aria-pressed={providerKind === 'ollama'} onclick={() => selectProvider('ollama')}>
              <strong>Local Ollama</strong>
              <span>Runs on your computer</span>
            </button>
            <button type="button" class="provider-option" class:provider-active={providerKind === 'openai-compatible'} aria-pressed={providerKind === 'openai-compatible'} onclick={() => selectProvider('openai-compatible')}>
              <strong>AI API token</strong>
              <span>Connect to a remote model</span>
            </button>
          </div>
        </fieldset>

        {#if providerKind === 'ollama'}
          <div class="provider-fields">
            <div class="provider-fields-row">
              <label class="form-field" for="ollama-url">
                <span class="form-label">Ollama URL</span>
                <input id="ollama-url" type="url" bind:value={settingsByKind.ollama.baseUrl} onblur={() => normalizeBaseUrl('ollama')} placeholder="http://localhost:11434"/>
              </label>
              <label class="form-field model-field" for="ollama-model">
                <span class="form-label">Model</span>
                {#if ollamaModels.length}
                  <select id="ollama-model" bind:value={settingsByKind.ollama.model}>
                    {#each ollamaModels as model}<option value={model}>{model}</option>{/each}
                  </select>
                {:else}
                  <input id="ollama-model" bind:value={settingsByKind.ollama.model} placeholder="qwen3:8b"/>
                {/if}
              </label>
              <button type="button" class="model-refresh" aria-label="Find installed Ollama models" onclick={() => refreshModels()} disabled={listingModels}>
                {#if listingModels}<LoaderCircle size={15} class="spin"/>{:else}Find models{/if}
              </button>
            </div>
            <p class="provider-note">Start Ollama on this computer and install a model before generating.</p>
          </div>
        {:else}
          <div class="provider-fields remote-fields">
            <label class="form-field" for="remote-url">
              <span class="form-label">API base URL</span>
              <input id="remote-url" type="url" bind:value={settingsByKind['openai-compatible'].baseUrl} onblur={() => normalizeBaseUrl('openai-compatible')} placeholder="https://api.openai.com/v1"/>
            </label>
            <label class="form-field" for="remote-model">
              <span class="form-label">Model</span>
              <input id="remote-model" bind:value={settingsByKind['openai-compatible'].model} placeholder="Model name"/>
            </label>
            <label class="form-field remote-token-field" for="remote-token">
              <span class="form-label">API key or access token</span>
              <input id="remote-token" type="password" autocomplete="new-password" bind:value={settingsByKind['openai-compatible'].manualAccessToken} placeholder="Paste your token here"/>
            </label>
            <p class="provider-note remote-provider-note">The token stays in this tab and is not saved with your presentation.</p>
          </div>
        {/if}

        <div class="simple-submit-row">
          <button class="generate-button simple-generate-button" type="submit" disabled={generating}>
            <span>{generating ? 'Creating presentation…' : 'Generate presentation'}</span>
            {#if generating}<LoaderCircle class="spin" size={17}/>{/if}
          </button>
        </div>
        {#if generating}
          <div class="generation-status">
            <div class="status-track"><div class="status-fill" style={`width:${16 + generationPhase * 25}%`}></div></div>
            <div class="status-copy"><span class="status-light"></span>{generationMessages[generationPhase]}<span class="status-ellipsis">…</span></div>
          </div>
        {/if}
      </form>
    </section>
  </main>{:else if presentation && slide}
  <main class="editor-shell">
    <header class="editor-topbar">
      <div class="editor-brand-group"><button class="back-home" aria-label="Back to home" onclick={() => inEditor = false}><ArrowLeft size={18}/></button><a class="brand editor-brand" href="#home" onclick={(event) => { event.preventDefault(); inEditor = false; }}><span class="brand-mark"><Sparkles size={14}/></span><span>studio<span class="brand-period">.</span></span></a><span class="top-divider"></span><input class="deck-title-input" value={presentation!.title} onfocus={() => titleAtEditStart = presentation!.title} oninput={updateTitle} onblur={finishTitleEdit} aria-label="Presentation title"/></div>
      <div class="editor-actions"><span class="saved-indicator"><Check size={13}/> Saved locally</span><span class="top-divider"></span><button class="toolbar-button" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo" onclick={undo} disabled={!undoStack.length}><Undo2 size={17}/></button><button class="toolbar-button" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo" onclick={redo} disabled={!redoStack.length}><Redo2 size={17}/></button><span class="top-divider"></span><button class="toolbar-button" title="Copy slide for PowerPoint" onclick={copySlide}><Copy size={16}/><span class="toolbar-label">Copy slide</span></button><button class="toolbar-button export-button" title="Download SVG" onclick={downloadCurrent}><Download size={16}/><span class="toolbar-label">Export</span></button><button class="toolbar-button" aria-label="Provider and OIDC settings" onclick={() => settingsOpen = true}><Settings2 size={17}/></button></div>
    </header>
    <div class="editor-workspace" class:has-selection={selected !== null}>
      <aside class="slides-panel">
        <div class="panel-heading"><span>YOUR STORY</span><span class="slide-total">{String(presentation.slides.length).padStart(2,'0')}</span></div>
        <div class="thumbnail-list" role="list">
          {#each presentation.slides as item, index (item.id)}
            <div class:active-thumb={activeSlide === index} class="thumb-row" role="listitem" draggable="true" ondragstart={() => dragSlideIndex = index} ondragover={(event) => event.preventDefault()} ondrop={(event) => { event.preventDefault(); reorderSlide(index); }} ondragend={() => dragSlideIndex = null}>
              <span class="thumb-number">{String(index+1).padStart(2,'0')}</span>
              <button class="thumb-button" aria-label={`Open slide ${index+1}`} onclick={() => setActive(index)}><span class="thumb-frame"><MiniSlide slide={item} theme={presentation.theme}/></span><span class="thumb-name">{item.layout || `Slide ${String(index+1).padStart(2,'0')}`}</span></button>
              <button class="thumb-menu" aria-label={`Duplicate slide ${index+1}`} title="Duplicate slide" onclick={() => duplicateSlide(index)}><Copy size={13}/></button>
              {#if presentation.slides.length > 1}<button class="thumb-delete" aria-label={`Delete slide ${index+1}`} title="Delete slide" onclick={() => deleteSlide(index)}><X size={13}/></button>{/if}
              <GripVertical class="drag-grip" size={13}/>
            </div>
          {/each}
        </div>
        <button class="add-slide-button" onclick={addSlide}><Plus size={16}/><span>New slide</span><span class="add-shortcut">+</span></button>
        <div class="story-bottom"><div class="story-progress"><span style={`width:${((activeSlide+1)/presentation.slides.length)*100}%`}></span></div><span>Slide {String(activeSlide+1).padStart(2,'0')} <i>/</i> {String(presentation.slides.length).padStart(2,'0')}</span></div>
      </aside>
      <section class="canvas-panel">
        <div class="canvas-toolbar"><div class="canvas-location"><span>CANVAS</span><ChevronRight size={13}/><span class="canvas-current">{itemLabel(slide.layout, activeSlide)}</span></div><div class="canvas-actions"><button class="canvas-tool" onclick={copySvgMarkup}><Copy size={14}/><span>Copy SVG</span></button><button class="canvas-tool" onclick={downloadCurrent}><Download size={14}/><span>Download</span></button><span class="zoom-label">16:9</span></div></div>
        <div class="canvas-stage-wrap">
          <div class="canvas-stage" role="application" aria-label="Presentation slide canvas. Select and drag elements; double-click text to edit." onpointerdown={handlePointerDown} onpointermove={handlePointerMove} ondblclick={handleDoubleClick}>
            <svg bind:this={stageSvg} class="main-slide-svg" aria-label={`Slide ${activeSlide+1}`}></svg>
            {#if inlineEditing !== null && slide.elements[inlineEditing]?.type === 'text'}
              {@const activeText = slide.elements[inlineEditing] as TextElement}
              <textarea class="inline-editor" style={`left:${activeText.x/SLIDE_WIDTH*100}%;top:${activeText.y/SLIDE_HEIGHT*100}%;width:${activeText.width/SLIDE_WIDTH*100}%;height:${activeText.height/SLIDE_HEIGHT*100}%;font-size:${activeText.fontSize/SLIDE_HEIGHT*100}cqh;font-weight:${activeText.fontWeight};color:${activeText.color};text-align:${activeText.align};font-family:${activeText.fontFamily || 'Inter, sans-serif'};transform:rotate(${activeText.rotation}deg);`} bind:value={editingText} onblur={() => finishInlineEdit(true)} onkeydown={(event) => { if (event.key === 'Escape') { event.preventDefault(); finishInlineEdit(false); } if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') finishInlineEdit(true); }} aria-label="Edit slide text"></textarea>
            {/if}
          </div>
        </div>
        <div class="ai-edit-bar"><div class="ai-edit-mark"><Sparkles size={16}/></div><input bind:value={promptInput} disabled={generating} placeholder="Tell your designer what to change…" onkeydown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendInstruction(); } }}/><span class="ai-edit-hint">{generating ? 'UPDATING…' : selectedElement !== null ? 'SELECTED' : 'THIS SLIDE'}</span><button type="button" class="ai-edit-send" aria-label="Apply AI instruction" onclick={() => void sendInstruction()} disabled={generating || !promptInput.trim()}>{#if generating}<LoaderCircle size={17} class="spin"/>{:else}<ChevronRight size={18}/>{/if}</button></div>
        <div class="canvas-footnote"><span>DOUBLE-CLICK TEXT TO EDIT</span><span>DRAG TO REPOSITION <i>·</i> <kbd>⌘</kbd> <kbd>Z</kbd> TO UNDO</span></div>
      </section>
      <aside class="inspector-panel">
        {#if selected}
          <div class="inspector-heading"><span>ELEMENT</span><div class="inspector-heading-actions"><button class="inspector-delete" title="Delete element" onclick={removeSelected}><Trash2 size={15}/></button><button class="inspector-delete" title="Close properties" onclick={() => selectedElement = null}><X size={15}/></button></div></div>
          <div class="element-kind"><span class="element-kind-icon"><Layers size={15}/></span><span>{selected.type === 'roundedRectangle' ? 'Rounded rectangle' : selected.type === 'bulletList' ? 'Bullet list' : selected.type[0].toUpperCase()+selected.type.slice(1)}</span><span class="element-order">{String(selectedElement!+1).padStart(2,'0')}</span></div>
          {#if selected.type === 'text'}
            <label class="property-block"><span>CONTENT</span><textarea class="property-text" value={selected.text} oninput={(event) => updateElement(selectedElement!, 'text', (event.currentTarget as HTMLTextAreaElement).value)} rows="4"></textarea></label>
            <label class="property-block"><span>TYPE SIZE <b>{Math.round(selected.fontSize)} px</b></span><input type="range" min="10" max="120" value={selected.fontSize} oninput={(event) => updateElement(selectedElement!, 'fontSize', (event.currentTarget as HTMLInputElement).value)}/></label>
            <label class="property-block"><span>WEIGHT</span><select value={selected.fontWeight} onchange={(event) => updateElement(selectedElement!, 'fontWeight', (event.currentTarget as HTMLSelectElement).value)}><option value="300">Light</option><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option><option value="800">Extra bold</option></select></label>
            <div class="property-block"><span>ALIGNMENT</span><div class="alignment-buttons">{#each ['left','center','right'] as align}<button class:alignment-active={selected.align === align} onclick={() => updateElement(selectedElement!, 'align', align)} aria-label={`Align ${align}`}><span class={`align-icon align-${align}`}></span></button>{/each}</div></div>
            <label class="property-block"><span>TEXT COLOR</span><span class="color-property"><input type="color" value={selected.color.startsWith('#') ? selected.color.slice(0,7) : '#f6f5ef'} oninput={(event) => updateElement(selectedElement!, 'color', (event.currentTarget as HTMLInputElement).value)}/><code>{selected.color}</code></span></label>
          {:else if selected.type === 'rectangle' || selected.type === 'roundedRectangle' || selected.type === 'circle' || selected.type === 'ellipse'}
            <label class="property-block"><span>FILL</span><span class="color-property"><input type="color" value={selected.fill.startsWith('#') ? selected.fill.slice(0,7) : '#191d20'} oninput={(event) => updateElement(selectedElement!, 'fill', (event.currentTarget as HTMLInputElement).value)}/><code>{selected.fill}</code></span></label>
            <label class="property-block"><span>BORDER</span><span class="color-property"><input type="color" value={selected.stroke.startsWith('#') ? selected.stroke.slice(0,7) : '#a7e35d'} oninput={(event) => updateElement(selectedElement!, 'stroke', (event.currentTarget as HTMLInputElement).value)}/><input class="small-number" type="number" min="0" max="32" value={selected.strokeWidth} oninput={(event) => updateElement(selectedElement!, 'strokeWidth', (event.currentTarget as HTMLInputElement).value)}/></span></label>
            {#if selected.type === 'roundedRectangle'}<label class="property-block"><span>CORNER RADIUS <b>{selected.radius}px</b></span><input type="range" min="0" max="100" value={selected.radius} oninput={(event) => updateElement(selectedElement!, 'radius', (event.currentTarget as HTMLInputElement).value)}/></label>{/if}
          {:else if selected.type === 'bulletList'}
            <label class="property-block"><span>BULLET TEXT</span><textarea class="property-text" value={selected.items.join('\n')} onblur={(event) => updateElement(selectedElement!, 'items', (event.currentTarget as HTMLTextAreaElement).value.split('\n').filter(Boolean).slice(0,12))} rows="6"></textarea></label>
            <label class="property-block"><span>TYPE SIZE <b>{Math.round(selected.fontSize)} px</b></span><input type="range" min="12" max="64" value={selected.fontSize} oninput={(event) => updateElement(selectedElement!, 'fontSize', (event.currentTarget as HTMLInputElement).value)}/></label>
            <label class="property-block"><span>BULLET COLOR</span><span class="color-property"><input type="color" value={selected.bulletColor.startsWith('#') ? selected.bulletColor.slice(0,7) : '#a7e35d'} oninput={(event) => updateElement(selectedElement!, 'bulletColor', (event.currentTarget as HTMLInputElement).value)}/><code>{selected.bulletColor}</code></span></label>
          {:else if selected.type === 'icon'}
            <label class="property-block"><span>ICON</span><select value={selected.icon} onchange={(event) => updateElement(selectedElement!, 'icon', (event.currentTarget as HTMLSelectElement).value)}>{#each ['sparkles','code','check','arrow-right','zap','brain','terminal','layers','shield','rocket','target','chart'] as icon}<option value={icon}>{icon}</option>{/each}</select></label>
            <label class="property-block"><span>ICON COLOR</span><span class="color-property"><input type="color" value={selected.color.startsWith('#') ? selected.color.slice(0,7) : '#a7e35d'} oninput={(event) => updateElement(selectedElement!, 'color', (event.currentTarget as HTMLInputElement).value)}/><code>{selected.color}</code></span></label>
          {:else if selected.type === 'image'}
            <div class="image-ready-note">{selected.searchQuery ? `Search request: ${selected.searchQuery}` : 'Image search provider can be connected here.'}</div><label class="property-block"><span>IMAGE CROP</span><select value={selected.objectFit} onchange={(event) => updateElement(selectedElement!, 'objectFit', (event.currentTarget as HTMLSelectElement).value)}><option value="cover">Cover</option><option value="contain">Contain</option></select></label><label class="property-block"><span>CORNER RADIUS <b>{selected.borderRadius}px</b></span><input type="range" min="0" max="100" value={selected.borderRadius} oninput={(event) => updateElement(selectedElement!, 'borderRadius', (event.currentTarget as HTMLInputElement).value)}/></label>
          {:else if selected.type === 'line'}
            <label class="property-block"><span>LINE COLOR</span><span class="color-property"><input type="color" value={selected.stroke.startsWith('#') ? selected.stroke.slice(0,7) : '#a7e35d'} oninput={(event) => updateElement(selectedElement!, 'stroke', (event.currentTarget as HTMLInputElement).value)}/><input class="small-number" type="number" min="1" max="40" value={selected.strokeWidth} oninput={(event) => updateElement(selectedElement!, 'strokeWidth', (event.currentTarget as HTMLInputElement).value)}/></span></label>
          {/if}
          <div class="property-block"><span>POSITION & SIZE <b>PX</b></span>{#if selected.type === 'line'}<div class="position-grid">{#each ['x1','y1','x2','y2'] as key}<label>{key}<input type="number" value={selected[key as 'x1'|'y1'|'x2'|'y2']} oninput={(event) => updateElement(selectedElement!, key, (event.currentTarget as HTMLInputElement).value)}/></label>{/each}</div>{:else}<div class="position-grid">{#each ['x','y','width','height'] as key}<label>{key === 'width' ? 'W' : key === 'height' ? 'H' : key.toUpperCase()}<input type="number" value={selected[key as 'x'|'y'|'width'|'height']} oninput={(event) => updateElement(selectedElement!, key, (event.currentTarget as HTMLInputElement).value)}/></label>{/each}</div>{/if}</div>
          <label class="property-block"><span>OPACITY <b>{Math.round((selected.opacity ?? 1)*100)}%</b></span><input type="range" min="0" max="1" step="0.01" value={selected.opacity ?? 1} oninput={(event) => updateElement(selectedElement!, 'opacity', (event.currentTarget as HTMLInputElement).value)}/></label>
          {#if selected.type !== 'line'}<label class="property-block"><span>ROTATION <b>{selected.rotation}°</b></span><input type="range" min="-180" max="180" value={selected.rotation} oninput={(event) => updateElement(selectedElement!, 'rotation', (event.currentTarget as HTMLInputElement).value)}/></label>{/if}
          <div class="layer-controls"><span>LAYER</span><button onclick={() => changeLayer(selectedElement!, -1)} title="Send backward">BACK</button><button onclick={() => changeLayer(selectedElement!, 1)} title="Bring forward">FRONT</button></div>
        {:else}
          <div class="inspector-empty"><span class="empty-sun">✳</span><span class="empty-kicker">YOUR CANVAS</span><h2>Make it yours.</h2><p>Select any element on your slide to edit its content, color, size and placement.</p><div class="quick-add"><button onclick={addText}><span class="quick-add-icon">T</span><span>Add text</span><Plus size={14}/></button><button onclick={addShape}><span class="quick-add-icon shape-add-icon"></span><span>Add shape</span><Plus size={14}/></button></div></div>
          <div class="slide-actions-group"><span>SLIDE ACTIONS</span><button onclick={regenerateCurrentSlide} disabled={generating}><Sparkles size={15}/><span>Redesign this slide</span><ChevronRight size={15}/></button><button onclick={copySlide}><Copy size={15}/><span>Copy for PowerPoint</span><ChevronRight size={15}/></button><button onclick={downloadCurrent}><Download size={15}/><span>Download SVG</span><ChevronRight size={15}/></button></div>
          <div class="theme-chip"><span class="theme-chip-dot" style={`background:${presentation.theme.primary}`}></span><span>{style}</span><span class="theme-chip-note">DESIGN SYSTEM</span></div>
        {/if}
      </aside>
    </div>
  </main>
{/if}

{#if settingsOpen}
  <div class="settings-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) settingsOpen = false; }}>
    <div class="settings-sheet" role="dialog" aria-modal="true" aria-label="AI provider settings">
      <header class="settings-header"><div><span class="settings-kicker">CONNECTIONS</span><h2>Your AI providers.</h2><p>Choose where your presentation designer runs.</p></div><button class="settings-close" aria-label="Close settings" onclick={() => settingsOpen = false}><X size={19}/></button></header>
      <div class="settings-section-label">LOCAL · ON YOUR DEVICE</div>
      <label class="settings-field"><span>Ollama URL</span><input bind:value={settingsByKind.ollama.baseUrl} onblur={() => normalizeBaseUrl('ollama')} placeholder="http://localhost:11434"/></label>
      <div class="settings-field"><span>Installed Ollama model</span><div class="model-select-row">{#if ollamaModels.length}<select bind:value={settingsByKind.ollama.model}>{#each ollamaModels as model}<option>{model}</option>{/each}</select>{:else}<input bind:value={settingsByKind.ollama.model} placeholder="qwen3:8b" list="ollama-models-settings"/><datalist id="ollama-models-settings">{#each ollamaModels as model}<option value={model}></option>{/each}</datalist>{/if}<button class="refresh-settings" onclick={() => refreshModels()} disabled={listingModels}>{#if listingModels}<LoaderCircle size={15} class="spin"/>{:else}Find models{/if}</button></div></div>
      <div class="settings-rule"></div>
      <div class="settings-section-label">REMOTE · OPENAI-COMPATIBLE</div>
      <label class="settings-field"><span>API base URL</span><input bind:value={settingsByKind['openai-compatible'].baseUrl} onblur={() => normalizeBaseUrl('openai-compatible')} placeholder="https://api.openai.com/v1"/></label>
      <label class="settings-field"><span>Model name</span><input bind:value={settingsByKind['openai-compatible'].model} placeholder="gpt-4o-mini"/></label>
      <label class="settings-field"><span>Bearer / access token <i>OPTIONAL</i></span><input type="password" autocomplete="new-password" bind:value={settingsByKind['openai-compatible'].manualAccessToken} placeholder="Paste token for this session"/></label>
      <p class="credential-note"><span class="lock-mark">◈</span> This token is held in memory and sent only to the API URL above. It is never saved with your presentation or to browser storage. Re-enter it after refreshing the page.</p>
      <div class="settings-rule"></div>
      <button class="oidc-toggle" onclick={() => oidcSection = !oidcSection}><div><span class="settings-section-label">ENTERPRISE IDENTITY</span><strong>OpenID Connect setup <span>ARCHITECTURE READY</span></strong></div><ChevronDown size={17} class={oidcSection ? 'rotate-chevron' : ''}/></button>
      {#if oidcSection}
        <div class="oidc-fields"><label class="settings-field"><span>Issuer URL</span><input bind:value={oidc.issuer} placeholder="https://identity.example.com"/></label><label class="settings-field"><span>Client ID</span><input bind:value={oidc.clientId} placeholder="Public client ID (PKCE)"/></label><label class="settings-field"><span>Redirect URI</span><input bind:value={oidc.redirectUri} placeholder="https://your-app.example/callback"/></label><label class="settings-field"><span>Scopes</span><input bind:value={oidc.scopes}/></label><p class="oidc-note">OIDC sign-in is not connected yet. The model keeps identity (ID token) separate from authorization (OAuth access token) and from the manually entered API token above. When connected, only an OAuth access token will authorize API calls; an ID token is never used as a bearer credential.</p></div>
      {/if}
      <footer class="settings-footer"><span><span class="online-dot"></span> Settings saved on this device</span><button onclick={() => settingsOpen = false}>Done <Check size={15}/></button></footer>
    </div>
  </div>
{/if}
{#if toast}<div class="toast-message"><span class="toast-mark">✳</span>{toast}</div>{/if}
