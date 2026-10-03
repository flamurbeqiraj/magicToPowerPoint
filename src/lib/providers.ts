import { presentationJsonSchema, validatePresentation, type GenerationRequest, type Presentation, type ProviderSettings, type ProviderKind, type Slide } from './model';

const SYSTEM_PROMPT = `You are an expert presentation designer and information designer. You create both the CONTENT and DESIGN of professional presentation slides. Think like a world-class PowerPoint and Keynote designer. Return only a JSON object that matches the requested schema. Never return SVG, HTML, CSS, markdown, or executable code.

You design a coherent narrative across the deck: an opening slide, a logical story in the middle, and a useful conclusion or next step. Create exact requested slide count. The first slide generally acts as an expressive cover, middle slides vary their composition, and the final slide resolves the story.

Act as the designer, not a text generator. Make deliberate choices about visual hierarchy, whitespace, typography, grouping, emphasis, colors, decorative geometry, backgrounds, and layout. Use the provided theme consistently while varying composition. Use a rich mix of layouts appropriate to the content: hero, editorial split, three cards, big statement, comparison, process, timeline, diagram, feature grid, quote, visual summary, and conclusion. Do not repeat title plus bullet-list slides. Do not force irrelevant charts or numbers. NEVER invent statistics, sources, quotes, or facts. Use qualitative language when no verified number is supplied. Keep copy concise and presentation-ready: short titles, useful captions, short supporting statements, a few focused bullets. Avoid essay paragraphs and lorem ipsum.

The only supported elements are text, rectangle, roundedRectangle, circle, ellipse, line, bulletList, icon, and image. Every slide has a unique id and an elements array in painter order, with the background first if needed. Place all content on a fixed 1280 × 720 canvas. Use good margins and intentional alignment. Text boxes should have generous dimensions and font sizes; ensure text fits. Use 8–12pt only for brief fine-print captions, never for main copy. Elements should form an intentional composition, not a pile of decoration. Use hex colors. Supported icons: sparkles, code, check, arrow-right, zap, brain, terminal, layers, shield, rocket, target, chart. For an image, provide a descriptive searchQuery only; do not invent a URL.

Theme values and presentation consistency matter. Treat the user's brief as subject, audience, and purpose. Make a clear narrative choice and use concrete, specific wording. No fabricated statistics.`;

function schemaForCount(count: number) {
  type MutableSchema = { [key:string]:unknown; properties:{ [key:string]:{ [key:string]:unknown; properties:{ [key:string]:unknown } } } };
  const schema = structuredClone(presentationJsonSchema) as unknown as MutableSchema;
  const presentationProperties = schema.properties.presentation.properties;
  const slideArray = presentationProperties.slides as Record<string,unknown>;
  presentationProperties.slides = { ...slideArray, minItems:count, maxItems:count };
  return schema;
}

function cleanBaseUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value.trim()); }
  catch { throw new Error('Enter a valid HTTP or HTTPS API base URL.'); }
  if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('API URLs must use HTTP or HTTPS and must not contain credentials, query strings, or fragments.');
  }
  return parsed.toString().replace(/\/+$/, '');
}
function friendlyFetchError(error: unknown, kind: ProviderKind): Error {
  if (error instanceof TypeError) {
    return new Error(kind === 'ollama'
      ? 'Could not connect to Ollama. Start Ollama, check its URL, and confirm that browser access is allowed.'
      : 'Could not reach that API. Check the base URL, network connection, and the provider’s browser CORS settings.');
  }
  return error instanceof Error ? error : new Error('The AI provider request failed.');
}

async function request(url: string, init: RequestInit, kind: ProviderKind): Promise<Response> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      let body: { error?: string | { message?:string }; message?: string } = {};
      try { body = await response.json() as typeof body; } catch { /* provider error bodies vary */ }
      const message = (typeof body.error === 'string' ? body.error : body.error?.message) || body.message || '';
      if (response.status === 400 && kind === 'lm-studio' && /no models loaded|load a model|developer page|lms load/i.test(message)) {
        throw new Error("LM Studio has no model loaded. Load a model in LM Studio's Developer or Local Server page, then enter its exact identifier in the provider settings.");
      }
      if (response.status === 400 && /(?:response_format|json_schema|structured output|format).*(?:not supported|unsupported|invalid)|(?:not support|unsupported|invalid).*(?:format|schema)/i.test(message)) throw new Error('STRUCTURED_OUTPUT_UNSUPPORTED');
      if (response.status === 401 || response.status === 403) throw new Error('Authentication failed. Check the access token for this API.');
      if (response.status === 404 && kind === 'ollama') throw new Error('Ollama endpoint or model was not found. Check the URL and model name.');
      if (/model.*(not found|does not exist)/i.test(message)) throw new Error('That model is not available at this endpoint. Check the model name.');
      if (response.status === 429) throw new Error('The provider rate limit was reached. Wait a moment and try again.');
      throw new Error(`The AI provider returned an error (${response.status}). Check its settings and try again.`);
    }
    return response;
  } catch (error) { throw friendlyFetchError(error, kind); }
}

export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const response = await request(`${cleanBaseUrl(baseUrl)}/api/tags`, { headers: { Accept: 'application/json' } }, 'ollama');
  const data = await response.json() as { models?: Array<{ name?: string }> };
  return (data.models ?? []).map(item => item.name).filter((name): name is string => Boolean(name));
}

export async function listLMStudioModels(baseUrl: string, accessToken = ''): Promise<string[]> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await request(`${cleanBaseUrl(baseUrl)}/models`, { headers }, 'lm-studio');
  const data = await response.json() as { data?: Array<{ id?: string }> };
  return (data.data ?? []).map(item => item.id).filter((id): id is string => Boolean(id));
}

export interface AIProviderAdapter {
  readonly kind: string;
  generate(prompt: string, schema: object, settings: ProviderSettings): Promise<string>;
}
const providerAdapters = new Map<string, AIProviderAdapter>();
export function registerAIProvider(adapter: AIProviderAdapter): void { providerAdapters.set(adapter.kind, adapter); }
registerAIProvider({ kind:'ollama', generate:generateOllama });
registerAIProvider({ kind:'openai-compatible', generate:generateOpenAICompatible });
registerAIProvider({ kind:'lm-studio', generate:generateOpenAICompatible });

export async function generate(requestData: GenerationRequest, settings: ProviderSettings): Promise<Presentation> {
  const count = requestData.slideIndex === undefined ? requestData.slides : 1;
  const schema = schemaForCount(count);
  const prompt = createUserPrompt(requestData);
  let raw: string;
  const provider = providerAdapters.get(settings.kind);
  if (!provider) throw new Error(`No AI provider is registered for "${settings.kind}".`);
  raw = await provider.generate(prompt, schema, settings);
  const { presentation, warnings } = validatePresentation(raw, count);
  if (warnings.length) console.info(`Presentation normalized: ${warnings.length} unsupported items were skipped.`);
  // AI supplied URLs are never fetched or placed directly into the document. Image requests go
  // through an ImageProvider once one is configured.
  for (const slide of presentation.slides) for (const element of slide.elements) {
    if (element.type === 'image' && element.source === 'ai') element.url = undefined;
  }
  return presentation;
}

function createUserPrompt(input: GenerationRequest): string {
  const base = `PRESENTATION BRIEF\n${input.brief}\n\nEXACT SLIDE COUNT\n${input.slideIndex === undefined ? input.slides : 1}\n\nSTYLE DIRECTION\n${input.style || 'Modern and professional'}${input.styleNotes?.trim() ? `\nADDITIONAL DESIGN NOTES\n${input.styleNotes.trim().slice(0,400)}` : ''}\n\nPRIMARY COLOR\n${input.primaryColor || 'Use your judgment'}\n\nBuild a varied, cohesive story. Return exactly the requested number of slides.`;
  if (input.slideIndex !== undefined && input.current) {
    const index = input.slideIndex;
    const currentSlide = input.current.slides[index];
    const neighbors = [
      { slide:input.current.slides[index - 1], position:index - 1 },
      { slide:input.current.slides[index + 1], position:index + 1 }
    ].filter((item): item is {slide:Slide;position:number} => Boolean(item.slide))
      .map(item => `Slide ${item.position + 1}: ${summarizeSlide(item.slide)}`).join('\n');
    const selected = input.selectedElements?.length
      ? `\nSELECTED ELEMENTS (in current slide order)\n${JSON.stringify(input.selectedElements)}\nUpdate only these selected elements and preserve every other element exactly. Keep the slide element count and ordering unchanged.` : '';
    return `${base}\n\nEXISTING DESIGN SYSTEM\n${JSON.stringify(input.current.theme)}\n\nTHIS IS SLIDE ${index + 1} OF ${input.current.slides.length}. Return a one-slide presentation containing only the redesigned slide. Keep the design consistent with neighbors while giving it an appropriate composition.\nCURRENT SLIDE\n${JSON.stringify(currentSlide)}\nNEIGHBOR SUMMARIES\n${neighbors || 'No neighboring slides.'}${selected}\nUSER INSTRUCTION (apply this exact change)\n${input.instruction || 'Improve clarity and visual quality.'}\n\nThe returned slide must visibly implement the user instruction. Preserve unrelated content and styling.`;
  }
  if (input.current && input.instruction) {
    return `${base}\n\nCURRENT PRESENTATION\n${JSON.stringify(input.current)}\n\nUSER EDIT INSTRUCTION\n${input.instruction}\n\nApply the requested change visibly. Preserve its subject, story, requested slide count, and consistent design system unless instructed otherwise.`;
  }
  return base;
}

function summarizeSlide(slide: Slide): string {
  return slide.elements.filter((element): element is Extract<typeof element, {type: 'text'}> => element.type === 'text')
    .slice(0, 4).map(element => element.text).join(' · ') || `${slide.layout || 'Visual'} composition`;
}

async function generateOllama(prompt: string, schema: object, settings: ProviderSettings): Promise<string> {
  const url = `${cleanBaseUrl(settings.baseUrl)}/api/chat`;
  const messages = [{ role:'system', content:SYSTEM_PROMPT }, { role:'user', content:prompt }];
  const send = (format: object | string | undefined) => request(url, {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ model:settings.model, stream:false, ...(format ? {format} : {}), options:{temperature:settings.temperature}, messages })
  }, 'ollama');
  let response: Response;
  try { response = await send(schema); }
  catch (error) {
    if (!(error instanceof Error) || error.message !== 'STRUCTURED_OUTPUT_UNSUPPORTED') throw error;
    try { response = await send('json'); }
    catch (jsonModeError) {
      if (!(jsonModeError instanceof Error) || jsonModeError.message !== 'STRUCTURED_OUTPUT_UNSUPPORTED') throw jsonModeError;
      response = await send(undefined);
    }
  }
  const data = await response.json() as { message?: { content?: string } };
  if (!data.message?.content) throw new Error('Ollama returned an empty response. Check the model and try again.');
  return data.message.content;
}

async function generateOpenAICompatible(prompt: string, schema: object, settings: ProviderSettings): Promise<string> {
  const baseUrl = cleanBaseUrl(settings.baseUrl);
  const providerKind: ProviderKind = settings.kind === 'lm-studio' ? 'lm-studio' : 'openai-compatible';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  // The manually entered access token lives in memory only. OIDC ID tokens are deliberately not used here.
  const bearer = settings.authorizationSource === 'oidc' ? settings.oauthAccessToken : settings.manualAccessToken;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const body: Record<string, unknown> = { model: settings.model, temperature: settings.temperature, messages: [
    { role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }
  ], response_format: { type: 'json_schema', json_schema: { name: 'presentation', strict: false, schema } } };
  let response: Response;
  try { response = await request(`${baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) }, providerKind); }
  catch (error) {
    if (!(error instanceof Error) || error.message !== 'STRUCTURED_OUTPUT_UNSUPPORTED') throw error;
    delete body.response_format;
    response = await request(`${baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) }, providerKind);
  }
  let data: { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
  try { data = await response.json() as typeof data; }
  catch { throw new Error('The API response was not valid JSON. Check that the base URL points to an OpenAI-compatible chat endpoint.'); }
  let content = data.choices?.[0]?.message?.content;
  if (!content && response.status >= 200) throw new Error('The API returned no presentation content. Check the model name and endpoint.');
  if (Array.isArray(content)) content = content.map(part => part.text || '').join('');
  if (content) return content;
  return '';
}
