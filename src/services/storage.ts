import {
  SubjectProfile,
  ReferenceBlueprint,
  ComponentKey,
  MasterOutfit,
  PromptMode,
  BackgroundProfile,
  SavedComponentItem,
  ToolType,
} from '../types';

const STORAGE_KEYS = {
  CUSTOM_KEY: 'rcs_gemini_key',
  ACTIVE_PROFILE: 'rcs_active_profile_id',
  PROFILES: 'rcs_subject_profiles_v1',
  OUTFITS: 'rcs_master_outfits_v1',
  ACTIVE_OUTFIT: 'rcs_active_outfit_id',
  BACKGROUNDS: 'rcs_background_profiles_v1',
  ACTIVE_BACKGROUND: 'rcs_active_background_id',
  COMPONENT_LIBRARY: 'rcs_component_library_v1',
  ACTIVE_PROMPT_MODE: 'rcs_active_prompt_mode',
  ACTIVE_TOOL: 'rcs_active_tool_v1',
  BLUEPRINTS: 'rcs_blueprints_v1',
  SETTINGS: 'rcs_settings',
  LAST_SCAN: 'rcs_last_scan_cache',
  WAITLIST_JOINED: 'rcs_waitlist_joined',
};

export const DEFAULT_MASTER_SUBJECT = `South Asian woman, mid-30s to early 40s, medium-deep warm golden-brown skin with natural texture, visible pores, slight uneven tone and fine natural lines. Oval slightly elongated face, soft moderate cheekbones, gently angular soft jaw. Almond-shaped eyes with very dark brown near-black irises, natural medium lids and slight outer corner droop. Medium natural eyebrows, deep black/dark brown, gentle arch, real hair texture. Medium nose with soft rounded tip and permanent small gold stud nose pin on the LEFT nostril. Medium lips with dark natural mauve/brownish-pink pigmentation. Small natural dark mole on LEFT cheek (mid-cheek level). Deep natural black wavy-to-curly hair. No beautification, no smoothing, no brightening, no anti-aging, no identity drift.`;

export const DEFAULT_MASTER_BODY = `LOCKED BODY PROPORTIONS:

Petite slim frame with naturally soft feminine proportions and a subtle pear-influenced silhouette. Narrower upper body transitioning naturally into fuller hips and glute area. Defined waist with an approximately 30-inch waist-to-36-inch hip proportion, creating a natural curved silhouette rather than an exaggerated hourglass shape.

Natural soft tissue distribution with gentle fullness through the lower abdomen and hips. The lower abdomen has subtle relaxed natural fullness below the waistline, while the upper abdomen remains comparatively flatter. Preserve realistic skin folds, body softness, and natural transitions between torso, waist, hips, and thighs.

Natural compact bust with soft teardrop-like volume, gently sloping upper contour, slightly fuller lower contour, and realistic gravity-influenced shape. Keep the bust proportionate to the petite frame, naturally soft rather than lifted, sculpted, or exaggerated. Preserve subtle natural asymmetry and realistic side-profile volume.

Soft natural thighs with realistic volume and proportion relative to the hips and lower body.

Preserve the overall body silhouette, proportions, natural softness, subtle asymmetry, and realistic anatomical transitions exactly as specified.

No exaggerated curves.
No body sculpting.
No artificial tightening.
No muscular definition.
No exaggerated bust or hip enlargement.
No slimming beyond the specified proportions.
No reshaping of the waist or hips.`;

export const SEED_PROFILES: SubjectProfile[] = [
  {
    id: 'profile_default_southasian',
    name: 'South Asian Woman (Authoritative)',
    masterSubject: DEFAULT_MASTER_SUBJECT,
    masterBody: DEFAULT_MASTER_BODY,
    tags: ['Default', 'Identity-Locked', 'Photorealistic'],
    createdAt: Date.now() - 86400000 * 2,
    updatedAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'profile_editorial_fashion',
    name: 'Editorial Studio Model',
    masterSubject: `High-fashion editorial subject, late 20s, East Asian heritage, clear warm-neutral porcelain skin tone with realistic epidermal translucency and natural micro-texture. Defined angular cheekbones, sculpted jawline, almond eyes with sharp focus and direct gaze. Minimalist styling, natural hair pulled back cleanly into a sleek architectural chignon. No artificial gloss or over-smoothing.`,
    masterBody: `LOCKED BODY PROPORTIONS:
Tall slender athletic frame with elongated proportions, straight collarbones, defined shoulder line, natural silhouette, natural anatomical symmetry without exaggerated hourglass distortion.`,
    tags: ['Editorial', 'Fashion', 'Studio'],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
  },
  {
    id: 'profile_character_candid',
    name: 'Candid Documentary Subject',
    masterSubject: `Mediterranean man, early 40s, olive undertones with weathered sun-drenched texture, laugh lines around dark hazel eyes, textured salt-and-pepper short beard with natural growth pattern, unruly dark wavy hair. Authentic unposed documentary realism.`,
    masterBody: `LOCKED BODY PROPORTIONS:
Broad sturdy build, natural posture, relaxed shoulders, realistic relaxed waistline, natural proportions consistent with lifestyle photojournalism.`,
    tags: ['Documentary', 'Candid', 'Realism'],
    createdAt: Date.now() - 3600000 * 5,
    updatedAt: Date.now() - 3600000 * 5,
  },
];

export const SEED_OUTFITS: MasterOutfit[] = [
  {
    id: 'outfit_classic_minimalist',
    name: 'Minimalist Ivory Silk & Tailored Linen',
    description: `A relaxed-tailored sleeveless ivory silk crepe top with a subtle high boat neckline and clean edges, paired with high-waisted wide-leg stone-beige breathable linen trousers. Minimalist gold thin bangle on the left wrist, clean leather sandals visible if feet are framed. Precise drape and realistic textile micro-weave without synthetic sheen.`,
    garmentType: 'Sleeveless top and wide-leg trousers',
    colors: 'Ivory, stone beige, muted warm neutral',
    materials: 'Silk crepe, natural woven linen',
    fit: 'Relaxed tailored, breathable, natural drape',
    sleeves: 'Sleeveless',
    neckline: 'Subtle high boat neckline',
    accessories: 'Delicate gold thin bangle on left wrist',
    footwear: 'Minimalist flat leather sandals',
    createdAt: Date.now() - 86400000 * 2,
    updatedAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'outfit_casual_denim_cotton',
    name: 'Classic White Crewneck & Raw Denim',
    description: `A perfectly fitted heavyweight organic white cotton crewneck t-shirt with clean finished seams, tucked gently into classic mid-rise straight-leg dark indigo raw selvedge denim jeans with a simple matte brown leather belt. Minimalist white canvas sneakers with off-white rubber soles. Natural cotton texture and visible denim twill weave.`,
    garmentType: 'T-shirt and straight-leg jeans',
    colors: 'Crisp white, dark indigo, matte cognac brown',
    materials: 'Heavyweight organic cotton jersey, raw selvedge denim',
    fit: 'Natural relaxed fit, gentle drape',
    sleeves: 'Short sleeve with neat folded hem',
    neckline: 'Classic ribbed crewneck',
    accessories: 'Matte brown leather belt with brass buckle',
    footwear: 'White low-top canvas sneakers',
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
  },
  {
    id: 'outfit_editorial_cashmere',
    name: 'Charcoal Cashmere & Pleated Trousers',
    description: `A fine-gauge charcoal grey lightweight cashmere crewneck knit with ribbed cuffs and hem, effortlessly tucked into high-rise charcoal melange pleated wool trousers. Subtle silver watch on leather strap. Understated luxury with authentic matte tactile depth and natural knit elasticity.`,
    garmentType: 'Fine knit sweater and pleated trousers',
    colors: 'Charcoal grey, slate melange',
    materials: 'Lightweight cashmere, fine tropical wool',
    fit: 'Soft tailoring, clean drape',
    sleeves: 'Long sleeves gently pushed to mid-forearm',
    neckline: 'Refined crewneck',
    accessories: 'Vintage slim silver watch',
    footwear: 'Black leather loafers',
    createdAt: Date.now() - 3600000 * 4,
    updatedAt: Date.now() - 3600000 * 4,
  },
];

export const SEED_BACKGROUNDS: BackgroundProfile[] = [
  {
    id: 'bg_minimalist_daylight_loft',
    name: 'Sunlit Minimalist Concrete Loft',
    background: `Unadorned matte warm-grey architectural micro-cement wall with subtle organic trowel texture, clean oak floorboards at the base, and soft out-of-focus neutral plaster column in the far background.`,
    environment: `Quiet contemporary indoor daylight studio loft with tall industrial north-facing windows and open airy spatial depth.`,
    lighting: `Soft directional natural window key light from camera-left at 45 degrees, gentle warm bounce fill from the oak floor, soft graduated shadow falloff with natural highlight roll-off on skin.`,
    tags: ['Studio', 'Daylight', 'Minimalist'],
    createdAt: Date.now() - 86400000 * 2,
    updatedAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'bg_golden_hour_terrace',
    name: 'Mediterranean Limestone Terrace',
    background: `Weathered warm travertine stone parapet and low terracotta planters with muted olive foliage in soft optical bokeh against a pale warm evening sky.`,
    environment: `Outdoor architectural rooftop terrace overlooking a coastal courtyard during late afternoon golden hour.`,
    lighting: `Warm low-elevation golden hour sunlight raking gently from the side, producing soft elongated shadows, subtle rim illumination along hair edges, and balanced ambient sky fill.`,
    tags: ['Outdoor', 'Golden Hour', 'Architectural'],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
  },
];

export const SEED_COMPONENT_ITEMS: SavedComponentItem[] = [
  {
    id: 'comp_pose_relaxed_contra',
    componentKey: 'pose',
    name: 'Relaxed Contrapposto Standing',
    description: `Standing upright in a natural contrapposto stance with primary weight resting on the right leg, left knee softly flexed with heel slightly lifted, pelvis subtly tilted, torso facing forward with a 15-degree relaxed shoulder turn, head level and facing the lens.`,
    tags: ['Standing', 'Editorial'],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
  },
  {
    id: 'comp_cam_eye_34',
    componentKey: 'camera',
    name: 'Eye-Level Three-Quarter Medium Perspective',
    description: `Eye-level camera positioned at medium portrait distance in a three-quarter horizontal viewing direction, natural normal-lens perspective with undistorted facial proportions and shallow depth of field.`,
    tags: ['Eye-Level', 'Three-Quarter'],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
  },
  {
    id: 'comp_expr_neutral_composed',
    componentKey: 'facial_expression',
    name: 'Composed Neutral Gaze',
    description: `Relaxed brow with zero forehead tension, eyelids naturally open with calm direct gaze toward the camera, soft cheek muscles, and lips gently closed in a neutral, unforced resting contour.`,
    tags: ['Neutral', 'Portrait'],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
  },
  {
    id: 'comp_hands_relaxed_sides',
    componentKey: 'hand_gestures',
    name: 'Relaxed Arms & Natural Fingers',
    description: `Left arm hangs naturally alongside the torso with a slight elbow bend and softly curved fingers; right forearm rests lightly near the waist with wrist neutral and fingers relaxed without tension.`,
    tags: ['Relaxed', 'Natural'],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
  },
];

function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn(`Storage quota warning for ${key}:`, err);
    return false;
  }
}

export const StorageService = {
  // Custom API Key
  getCustomApiKey(): string {
    try {
      return localStorage.getItem(STORAGE_KEYS.CUSTOM_KEY) || '';
    } catch {
      return '';
    }
  },
  setCustomApiKey(key: string): void {
    try {
      if (!key) localStorage.removeItem(STORAGE_KEYS.CUSTOM_KEY);
      else safeSetItem(STORAGE_KEYS.CUSTOM_KEY, key);
    } catch (e) {
      console.error(e);
    }
  },

  // Active Tool
  getActiveTool(): ToolType {
    try {
      const val = localStorage.getItem(STORAGE_KEYS.ACTIVE_TOOL) as ToolType;
      if (val === 'general_extractor' || val === 'subject_swapping' || val === 'camera_controller') {
        return val;
      }
      return 'general_extractor';
    } catch {
      return 'general_extractor';
    }
  },
  setActiveTool(tool: ToolType): void {
    safeSetItem(STORAGE_KEYS.ACTIVE_TOOL, tool);
  },

  // Subject Profiles
  getProfiles(): SubjectProfile[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PROFILES);
      if (!raw) {
        this.saveProfiles(SEED_PROFILES);
        return SEED_PROFILES;
      }
      const parsed: SubjectProfile[] = JSON.parse(raw);
      return parsed;
    } catch {
      return SEED_PROFILES;
    }
  },
  saveProfiles(profiles: SubjectProfile[]): void {
    safeSetItem(STORAGE_KEYS.PROFILES, JSON.stringify(profiles));
  },
  getProfileById(id: string): SubjectProfile | undefined {
    return this.getProfiles().find((p) => p.id === id);
  },
  saveProfile(profile: SubjectProfile): void {
    const list = this.getProfiles();
    // Avoid duplicate records if same name & subject content
    const idx = list.findIndex((p) => p.id === profile.id);
    if (idx >= 0) {
      list[idx] = { ...profile, updatedAt: Date.now() };
    } else {
      list.unshift({ ...profile, createdAt: Date.now(), updatedAt: Date.now() });
    }
    this.saveProfiles(list);
  },
  deleteProfile(id: string): void {
    const list = this.getProfiles().filter((p) => p.id !== id);
    this.saveProfiles(list);
  },

  // Active profile selection
  getActiveProfileId(): string {
    try {
      return localStorage.getItem(STORAGE_KEYS.ACTIVE_PROFILE) || 'profile_default_southasian';
    } catch {
      return 'profile_default_southasian';
    }
  },
  setActiveProfileId(id: string): void {
    safeSetItem(STORAGE_KEYS.ACTIVE_PROFILE, id);
  },

  // Master Outfits
  getOutfits(): MasterOutfit[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.OUTFITS);
      if (!raw) {
        this.saveOutfits(SEED_OUTFITS);
        return SEED_OUTFITS;
      }
      return JSON.parse(raw);
    } catch {
      return SEED_OUTFITS;
    }
  },
  saveOutfits(outfits: MasterOutfit[]): void {
    safeSetItem(STORAGE_KEYS.OUTFITS, JSON.stringify(outfits));
  },
  getOutfitById(id: string): MasterOutfit | undefined {
    return this.getOutfits().find((o) => o.id === id);
  },
  saveOutfit(outfit: MasterOutfit): void {
    const list = this.getOutfits();
    const idx = list.findIndex((o) => o.id === outfit.id);
    if (idx >= 0) {
      list[idx] = { ...outfit, updatedAt: Date.now() };
    } else {
      list.unshift({ ...outfit, createdAt: Date.now(), updatedAt: Date.now() });
    }
    this.saveOutfits(list);
  },
  deleteOutfit(id: string): void {
    const list = this.getOutfits().filter((o) => o.id !== id);
    this.saveOutfits(list);
  },
  getActiveOutfitId(): string {
    try {
      return localStorage.getItem(STORAGE_KEYS.ACTIVE_OUTFIT) || 'outfit_classic_minimalist';
    } catch {
      return 'outfit_classic_minimalist';
    }
  },
  setActiveOutfitId(id: string): void {
    safeSetItem(STORAGE_KEYS.ACTIVE_OUTFIT, id);
  },

  // Background Profiles
  getBackgrounds(): BackgroundProfile[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.BACKGROUNDS);
      if (!raw) {
        this.saveBackgrounds(SEED_BACKGROUNDS);
        return SEED_BACKGROUNDS;
      }
      return JSON.parse(raw);
    } catch {
      return SEED_BACKGROUNDS;
    }
  },
  saveBackgrounds(bgs: BackgroundProfile[]): void {
    safeSetItem(STORAGE_KEYS.BACKGROUNDS, JSON.stringify(bgs));
  },
  getBackgroundById(id: string): BackgroundProfile | undefined {
    return this.getBackgrounds().find((b) => b.id === id);
  },
  saveBackground(bg: BackgroundProfile): void {
    const list = this.getBackgrounds();
    const idx = list.findIndex((b) => b.id === bg.id);
    if (idx >= 0) {
      list[idx] = { ...bg, updatedAt: Date.now() };
    } else {
      list.unshift({ ...bg, createdAt: Date.now(), updatedAt: Date.now() });
    }
    this.saveBackgrounds(list);
  },
  deleteBackground(id: string): void {
    const list = this.getBackgrounds().filter((b) => b.id !== id);
    this.saveBackgrounds(list);
  },

  // Component Library (Poses, Cameras, Expressions, Hand/Leg Gestures, Camera Reference Components, etc.)
  getComponentLibrary(filterKey?: string): SavedComponentItem[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.COMPONENT_LIBRARY);
      const list: SavedComponentItem[] = raw ? JSON.parse(raw) : SEED_COMPONENT_ITEMS;
      if (!raw) {
        this.saveComponentLibrary(SEED_COMPONENT_ITEMS);
      }
      if (filterKey) {
        return list.filter((item) => item.componentKey === filterKey);
      }
      return list;
    } catch {
      return filterKey
        ? SEED_COMPONENT_ITEMS.filter((i) => i.componentKey === filterKey)
        : SEED_COMPONENT_ITEMS;
    }
  },
  saveComponentLibrary(items: SavedComponentItem[]): void {
    safeSetItem(STORAGE_KEYS.COMPONENT_LIBRARY, JSON.stringify(items));
  },
  saveComponentItem(item: SavedComponentItem): SavedComponentItem {
    const list = this.getComponentLibrary();
    // Prevent duplicate records when saving same componentKey + name + description
    const existingIdx = list.findIndex(
      (i) =>
        i.id === item.id ||
        (i.componentKey === item.componentKey &&
          i.name.toLowerCase() === item.name.toLowerCase() &&
          i.description.trim() === item.description.trim())
    );
    if (existingIdx >= 0) {
      const updated = { ...list[existingIdx], ...item, id: list[existingIdx].id, updatedAt: Date.now() };
      list[existingIdx] = updated;
      this.saveComponentLibrary(list);
      return updated;
    } else {
      const created = { ...item, createdAt: Date.now(), updatedAt: Date.now() };
      list.unshift(created);
      this.saveComponentLibrary(list);
      return created;
    }
  },
  deleteComponentItem(id: string): void {
    const list = this.getComponentLibrary().filter((i) => i.id !== id);
    this.saveComponentLibrary(list);
  },

  // Active Prompt Mode
  getActivePromptMode(): PromptMode {
    try {
      const mode = localStorage.getItem(STORAGE_KEYS.ACTIVE_PROMPT_MODE);
      if (mode === 'replace_subject' || mode === 'replace_subject_outfit' || mode === 'reference_control') {
        return mode;
      }
      return 'reference_control';
    } catch {
      return 'reference_control';
    }
  },
  setActivePromptMode(mode: PromptMode): void {
    safeSetItem(STORAGE_KEYS.ACTIVE_PROMPT_MODE, mode);
  },

  // Blueprints / Projects
  getBlueprints(): ReferenceBlueprint[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.BLUEPRINTS);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },
  saveBlueprints(blueprints: ReferenceBlueprint[]): void {
    // If localStorage is near capacity, strip oversized data URLs from older thumbnails
    if (!safeSetItem(STORAGE_KEYS.BLUEPRINTS, JSON.stringify(blueprints))) {
      const compact = blueprints.map((b, idx) => ({
        ...b,
        referenceThumbnails: idx < 8 ? b.referenceThumbnails.slice(0, 1) : [],
      }));
      safeSetItem(STORAGE_KEYS.BLUEPRINTS, JSON.stringify(compact));
    }
  },
  saveBlueprint(blueprint: ReferenceBlueprint): void {
    const list = this.getBlueprints();
    const idx = list.findIndex((b) => b.id === blueprint.id);
    if (idx >= 0) {
      list[idx] = { ...blueprint, updatedAt: Date.now() };
    } else {
      list.unshift({ ...blueprint, createdAt: Date.now(), updatedAt: Date.now() });
    }
    this.saveBlueprints(list);
  },
  renameBlueprint(id: string, newTitle: string): void {
    const list = this.getBlueprints();
    const idx = list.findIndex((b) => b.id === id);
    if (idx >= 0 && newTitle.trim()) {
      list[idx] = { ...list[idx], title: newTitle.trim(), updatedAt: Date.now() };
      this.saveBlueprints(list);
    }
  },
  deleteBlueprint(id: string): void {
    const list = this.getBlueprints().filter((b) => b.id !== id);
    this.saveBlueprints(list);
  },

  // Waitlist Status
  isWaitlistJoined(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEYS.WAITLIST_JOINED) === 'true';
    } catch {
      return false;
    }
  },
  setWaitlistJoined(status: boolean): void {
    safeSetItem(STORAGE_KEYS.WAITLIST_JOINED, status ? 'true' : 'false');
  },
};
