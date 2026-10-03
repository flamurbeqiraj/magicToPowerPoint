import { z } from 'zod';

export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;
const color = z.string().regex(/^(#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})|none|transparent)$/).max(16);
const fontFamily = z.string().min(1).max(60).regex(/^[\w ,.'"-]+$/);
const box = {
  x: z.number().min(-1280).max(2560),
  y: z.number().min(-720).max(1440),
  width: z.number().min(0).max(2560),
  height: z.number().min(0).max(1440),
  opacity: z.number().min(0).max(1).default(1),
  rotation: z.number().min(-360).max(360).default(0)
};
const align = z.enum(['left', 'center', 'right']).default('left');
const verticalAlign = z.enum(['top', 'middle', 'bottom']).default('top');

export const themeSchema = z.object({
  background: color, surface: color, primary: color, secondary: color, accent: color,
  textPrimary: color, textSecondary: color, fontFamily
}).strict();

const textElement = z.object({
  type: z.literal('text'), ...box, text: z.string().max(1400), fontSize: z.number().min(8).max(180),
  fontWeight: z.number().min(100).max(900).default(400), fontFamily: fontFamily.optional(),
  color, align, verticalAlign, letterSpacing: z.number().min(-4).max(24).default(0)
}).strict();

const rectElement = z.object({
  type: z.enum(['rectangle', 'roundedRectangle']), ...box, fill: color, stroke: color.default('none'),
  strokeWidth: z.number().min(0).max(32).default(0), radius: z.number().min(0).max(160).default(18)
}).strict();
const circleElement = z.object({
  type: z.enum(['circle', 'ellipse']), ...box, fill: color, stroke: color.default('none'),
  strokeWidth: z.number().min(0).max(32).default(0)
}).strict();
const lineElement = z.object({
  type: z.literal('line'), x1: z.number().min(-1280).max(2560), y1: z.number().min(-720).max(1440),
  x2: z.number().min(-1280).max(2560), y2: z.number().min(-720).max(1440),
  stroke: color, strokeWidth: z.number().min(0.1).max(40), opacity: z.number().min(0).max(1).default(1)
}).strict();
const bulletElement = z.object({
  type: z.literal('bulletList'), ...box, items: z.array(z.string().max(220)).min(1).max(12),
  fontSize: z.number().min(8).max(80), fontWeight: z.number().min(100).max(900).default(400),
  color, bulletColor: color, lineSpacing: z.number().min(1).max(3).default(1.35),
  fontFamily: fontFamily.optional(), align
}).strict();
const iconElement = z.object({
  type: z.literal('icon'), ...box, icon: z.enum(['sparkles', 'code', 'check', 'arrow-right', 'zap', 'brain', 'terminal', 'layers', 'shield', 'rocket', 'target', 'chart']), color
}).strict();
const imageElement = z.object({
  type: z.literal('image'), ...box, url: z.string().url().max(2048).refine(value => { try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; } catch { return false; } }).optional(), searchQuery: z.string().max(180).optional(),
  objectFit: z.enum(['cover', 'contain']).default('cover'), crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).optional(),
  borderRadius: z.number().min(0).max(180).default(0), attribution: z.string().max(300).optional(), source: z.enum(['user', 'imageProvider', 'ai']).default('ai')
}).strict();

export const elementSchema = z.discriminatedUnion('type', [textElement, rectElement, circleElement, lineElement, bulletElement, iconElement, imageElement]);
export type SlideElement = z.infer<typeof elementSchema>;
export type TextElement = Extract<SlideElement, {type: 'text'}>;
export type Slide = { id: string; layout?: string; elements: SlideElement[] };
export type Presentation = { title: string; theme: z.infer<typeof themeSchema>; slides: Slide[] };
export type PresentationResponse = { presentation: Presentation };

const slideSchema = z.object({ id: z.string().min(1).max(80), layout: z.string().max(40).optional(), elements: z.array(elementSchema).min(1).max(80) }).strict();
const presentationSchema = z.object({ title: z.string().min(1).max(140), theme: themeSchema, slides: z.array(slideSchema).min(1).max(30) }).strict();
export const responseSchema = z.object({ presentation: presentationSchema }).strict();
export const presentationJsonSchema = z.toJSONSchema(responseSchema, { target:'draft-07', unrepresentable:'any' });

export type ValidationResult = { presentation: Presentation; warnings: string[] };
export function validatePresentation(input: unknown, expectedSlides?: number): ValidationResult {
  const warnings: string[] = [];
  let candidate: unknown = input;
  if (typeof candidate === 'string') {
    let source = candidate.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { candidate = JSON.parse(source); }
    catch {
      const start = source.indexOf('{'), end = source.lastIndexOf('}');
      if (start < 0 || end <= start) throw new Error('The AI response did not contain valid presentation JSON.');
      try { candidate = JSON.parse(source.slice(start, end + 1)); }
      catch { throw new Error('The AI response could not be repaired into valid JSON. Try again or use a different model.'); }
    }
  }
  const base = responseSchema.safeParse(candidate);
  if (!base.success) {
    const maybe = candidate as { presentation?: { slides?: unknown[]; title?: string; theme?: unknown } };
    if (!maybe?.presentation || !Array.isArray(maybe.presentation.slides)) throw new Error('The AI response was missing a presentation or slide list. Try again.');
    const safeSlides: Slide[] = [];
    for (let slideIndex = 0; slideIndex < maybe.presentation.slides.length; slideIndex++) {
      const rawSlide = maybe.presentation.slides[slideIndex] as { id?: unknown; layout?: unknown; elements?: unknown[] };
      if (!rawSlide || !Array.isArray(rawSlide.elements)) { warnings.push(`Skipped malformed slide ${slideIndex + 1}.`); continue; }
      const elements: SlideElement[] = [];
      for (const rawElement of rawSlide.elements) {
        const parsed = elementSchema.safeParse(rawElement);
        if (!parsed.success) { warnings.push(`Skipped an unsupported or malformed element on slide ${slideIndex + 1}.`); continue; }
        const element = parsed.data;
        if (element.type !== 'line') {
          element.x = Math.min(2560, Math.max(-1280, element.x)); element.y = Math.min(1440, Math.max(-720, element.y));
          element.width = Math.min(2560, Math.max(0, element.width)); element.height = Math.min(1440, Math.max(0, element.height));
        }
        elements.push(element);
        if (elements.length === 80) { warnings.push(`Limited slide ${slideIndex + 1} to 80 elements.`); break; }
      }
      safeSlides.push({ id: typeof rawSlide.id === 'string' ? rawSlide.id.slice(0, 80) : `slide-${slideIndex + 1}`, layout: typeof rawSlide.layout === 'string' ? rawSlide.layout.slice(0, 40) : undefined, elements });
    }
    const recovered = responseSchema.safeParse({ presentation: { ...maybe.presentation, slides: safeSlides } });
    if (!recovered.success) throw new Error('The presentation did not meet the required structure. Try again or use a different model.');
    if (expectedSlides && recovered.data.presentation.slides.length !== expectedSlides) throw new Error(`The model returned ${recovered.data.presentation.slides.length} slides; ${expectedSlides} were requested. Try again.`);
    return { presentation: recovered.data.presentation as Presentation, warnings };
  }
  if (expectedSlides && base.data.presentation.slides.length !== expectedSlides) throw new Error(`The model returned ${base.data.presentation.slides.length} slides; ${expectedSlides} were requested. Try again.`);
  return { presentation: base.data.presentation as Presentation, warnings };
}

export function clone<T>(value: T): T { return structuredClone(value); }
export function defaultTheme(primary = '#b4f15e'): Presentation['theme'] {
  return { background:'#101214', surface:'#191d20', primary, secondary:'#8778ff', accent:'#70d6cc', textPrimary:'#f6f5ef', textSecondary:'#a6aba9', fontFamily:'Inter' };
}

export type ProviderKind = 'ollama' | 'openai-compatible';
export type OidcIdentity = { idToken: string; subject: string; issuer: string };
export type OAuthAccessCredential = { accessToken: string; expiresAt?: number };
export type ManualAccessCredential = { accessToken: string };
export type ProviderSettings = {
  kind: string; baseUrl: string; model: string; manualAccessToken: string; temperature: number;
  authorizationSource?: 'manual' | 'oidc'; oauthAccessToken?: string;
};
export type OidcSettings = { issuer: string; clientId: string; redirectUri: string; scopes: string; enabled: boolean };
export type GenerationRequest = { brief: string; slides: number; style: string; styleNotes?: string; primaryColor: string; current?: Presentation; slideIndex?: number; instruction?: string; selectedElements?: SlideElement[] };
