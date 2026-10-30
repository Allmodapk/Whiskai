import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import {
  SubjectProfile,
  MasterOutfit,
  BackgroundProfile,
  SavedComponentItem,
  ComponentKey,
  COMPONENT_LABELS,
  ALL_COMPONENT_KEYS,
  CameraComponentKey,
  CAMERA_COMPONENT_LABELS,
  ImageDataItem,
} from '../types';
import { StorageService, DEFAULT_MASTER_SUBJECT, DEFAULT_MASTER_BODY } from '../services/storage';
import { ImageDB } from '../services/imageDb';
import { postApiJson, extractApiErrorMessage } from '../services/apiClient';
import {
  Users,
  Shirt,
  Image as ImageIcon,
  Layers,
  Plus,
  Trash2,
  Copy,
  Edit2,
  Check,
  X,
  Upload,
  Loader2,
} from 'lucide-react';

interface ProfileManagerProps {
  activeProfileId: string;
  onSelectProfile: (profile: SubjectProfile) => void;
  activeOutfitId?: string;
  onSelectOutfit?: (outfit: MasterOutfit) => void;
}

type ProfileSection = 'subjects' | 'outfits' | 'backgrounds' | 'components';

export const ProfileManager: React.FC<ProfileManagerProps> = ({
  activeProfileId,
  onSelectProfile,
  activeOutfitId,
  onSelectOutfit,
}) => {
  const [activeSection, setActiveSection] = useState<ProfileSection>('subjects');

  // Data lists
  const [profiles, setProfiles] = useState<SubjectProfile[]>(() => StorageService.getProfiles());
  const [outfits, setOutfits] = useState<MasterOutfit[]>(() => StorageService.getOutfits());
  const [backgrounds, setBackgrounds] = useState<BackgroundProfile[]>(() =>
    StorageService.getBackgrounds()
  );
  const [componentItems, setComponentItems] = useState<SavedComponentItem[]>(() =>
    StorageService.getComponentLibrary()
  );
  const [componentFilter, setComponentFilter] = useState<ComponentKey | 'all'>('all');

  // Subject Modal State
  const [isSubjectModalOpen, setIsSubjectModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<SubjectProfile | null>(null);
  const [subjectName, setSubjectName] = useState('');
  const [subjectText, setSubjectText] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [subjectTags, setSubjectTags] = useState('');
  const [subjectImages, setSubjectImages] = useState<ImageDataItem[]>([]);
  const [isAnalyzingSubject, setIsAnalyzingSubject] = useState(false);
  const [subjectAnalysisError, setSubjectAnalysisError] = useState<string | null>(null);
  const subjectFileInputRef = useRef<HTMLInputElement>(null);

  // Outfit Modal State
  const [isOutfitModalOpen, setIsOutfitModalOpen] = useState(false);
  const [editingOutfit, setEditingOutfit] = useState<MasterOutfit | null>(null);
  const [outfitName, setOutfitName] = useState('');
  const [outfitDesc, setOutfitDesc] = useState('');
  const [outfitGarment, setOutfitGarment] = useState('');
  const [outfitColors, setOutfitColors] = useState('');
  const [outfitMaterials, setOutfitMaterials] = useState('');
  const [outfitFit, setOutfitFit] = useState('');
  const [outfitSleeves, setOutfitSleeves] = useState('');
  const [outfitNeckline, setOutfitNeckline] = useState('');
  const [outfitAccessories, setOutfitAccessories] = useState('');
  const [outfitFootwear, setOutfitFootwear] = useState('');
  const [outfitImage, setOutfitImage] = useState<ImageDataItem | null>(null);
  const [isAnalyzingOutfit, setIsAnalyzingOutfit] = useState(false);
  const [outfitAnalysisError, setOutfitAnalysisError] = useState<string | null>(null);
  const outfitFileInputRef = useRef<HTMLInputElement>(null);

  // Background Modal State
  const [isBgModalOpen, setIsBgModalOpen] = useState(false);
  const [editingBg, setEditingBg] = useState<BackgroundProfile | null>(null);
  const [bgName, setBgName] = useState('');
  const [bgDesc, setBgDesc] = useState('');
  const [bgEnvironment, setBgEnvironment] = useState('');
  const [bgLighting, setBgLighting] = useState('');
  const [bgTags, setBgTags] = useState('');
  const [bgImage, setBgImage] = useState<ImageDataItem | null>(null);
  const [isAnalyzingBg, setIsAnalyzingBg] = useState(false);
  const [bgAnalysisError, setBgAnalysisError] = useState<string | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);

  // Component Library Modal State
  const [isCompModalOpen, setIsCompModalOpen] = useState(false);
  const [editingComp, setEditingComp] = useState<SavedComponentItem | null>(null);
  const [compKey, setCompKey] = useState<ComponentKey>('pose');
  const [compName, setCompName] = useState('');
  const [compDesc, setCompDesc] = useState('');
  const [compTags, setCompTags] = useState('');

  const reloadAll = () => {
    setProfiles(StorageService.getProfiles());
    setOutfits(StorageService.getOutfits());
    setBackgrounds(StorageService.getBackgrounds());
    setComponentItems(StorageService.getComponentLibrary());
  };

  // Optimize uploaded image via HTML5 Canvas
  const optimizeImageFile = (file: File): Promise<ImageDataItem> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const rawUrl = e.target?.result as string;
        const img = new Image();
        img.onload = () => {
          const MAX_DIM = 1400;
          let w = img.width;
          let h = img.height;
          if (w > MAX_DIM || h > MAX_DIM) {
            if (w > h) {
              h = Math.round((h * MAX_DIM) / w);
              w = MAX_DIM;
            } else {
              w = Math.round((w * MAX_DIM) / h);
              h = MAX_DIM;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
            const base64 = dataUrl.split(',')[1];
            resolve({
              id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              data: base64,
              mimeType: 'image/jpeg',
              previewUrl: dataUrl,
              name: file.name,
            });
          } else {
            const base64 = rawUrl.split(',')[1];
            resolve({
              id: 'img_' + Date.now(),
              data: base64,
              mimeType: file.type || 'image/jpeg',
              previewUrl: rawUrl,
              name: file.name,
            });
          }
        };
        img.onerror = reject;
        img.src = rawUrl;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Create thumbnail (small 240px for card display)
  const createSmallThumbnail = (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const MAX_T = 240;
        let w = img.width;
        let h = img.height;
        if (w > h) {
          h = Math.round((h * MAX_T) / w);
          w = MAX_T;
        } else {
          w = Math.round((w * MAX_T) / h);
          h = MAX_T;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        } else {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  // --- SUBJECT HANDLERS ---
  const handleOpenCreateSubject = () => {
    setEditingSubject(null);
    setSubjectName('');
    setSubjectText('');
    setBodyText('');
    setSubjectTags('Identity, Custom');
    setSubjectImages([]);
    setSubjectAnalysisError(null);
    setIsSubjectModalOpen(true);
  };

  const handleOpenEditSubject = async (p: SubjectProfile) => {
    setEditingSubject(p);
    setSubjectName(p.name);
    setSubjectText(p.masterSubject);
    setBodyText(p.masterBody);
    setSubjectTags((p.tags || []).join(', '));
    setSubjectImages([]);
    setSubjectAnalysisError(null);
    setIsSubjectModalOpen(true);

    if (p.referenceImageIds && p.referenceImageIds.length > 0) {
      const loaded: ImageDataItem[] = [];
      for (const imgId of p.referenceImageIds) {
        const dataUrl = await ImageDB.getImage(imgId);
        if (dataUrl) {
          const base64 = dataUrl.split(',')[1] || '';
          loaded.push({
            id: imgId,
            data: base64,
            mimeType: 'image/jpeg',
            previewUrl: dataUrl,
          });
        }
      }
      if (loaded.length > 0) {
        setSubjectImages(loaded);
      }
    }
  };

  const handleSubjectImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const remainingSlots = 5 - subjectImages.length;
    const toProcess = Array.from(files).slice(0, remainingSlots);
    const items: ImageDataItem[] = [];
    for (const f of toProcess) {
      if (f.type.startsWith('image/')) {
        const opt = await optimizeImageFile(f);
        items.push(opt);
      }
    }
    setSubjectImages((prev) => [...prev, ...items]);
    e.target.value = '';
  };

  const handleAnalyzeSubjectImages = async () => {
    if (subjectImages.length === 0) return;
    setIsAnalyzingSubject(true);
    setSubjectAnalysisError(null);
    try {
      const customKey = StorageService.getCustomApiKey();
      const data = await postApiJson<any>(
        '/api/analyze-subject-profile',
        {
          images: subjectImages.map((img) => ({ data: img.data, mimeType: img.mimeType })),
        },
        { customKey }
      );

      const prof = data.profile || {};
      if (!subjectName.trim() && prof.suggestedName) {
        setSubjectName(prof.suggestedName);
      }
      if (prof.masterSubject) setSubjectText(prof.masterSubject);
      if (prof.masterBody) setBodyText(prof.masterBody);
      if (Array.isArray(prof.tags) && prof.tags.length > 0) {
        setSubjectTags(prof.tags.join(', '));
      }
    } catch (err: any) {
      setSubjectAnalysisError(
        extractApiErrorMessage(err, 'Could not analyze subject images.')
      );
    } finally {
      setIsAnalyzingSubject(false);
    }
  };

  const handleSaveSubject = async () => {
    const finalName = subjectName.trim() || (subjectText.trim() ? `Subject Profile (${new Date().toLocaleDateString()})` : '');
    if (!finalName) {
      setSubjectAnalysisError('Please enter a Subject Profile Name or upload photos to analyze.');
      return;
    }
    const tags = subjectTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    let thumb = editingSubject?.thumbnailUrl;
    const imageIds: string[] = [];

    if (subjectImages.length > 0) {
      thumb = await createSmallThumbnail(subjectImages[0].previewUrl);
      for (const img of subjectImages) {
        await ImageDB.saveImage(img.id, img.previewUrl, img.mimeType);
        imageIds.push(img.id);
      }
    } else if (editingSubject?.referenceImageIds) {
      imageIds.push(...editingSubject.referenceImageIds);
    }

    const profile: SubjectProfile = {
      id: editingSubject ? editingSubject.id : 'profile_' + Date.now(),
      name: finalName,
      masterSubject: subjectText.trim() || DEFAULT_MASTER_SUBJECT,
      masterBody: bodyText.trim() || DEFAULT_MASTER_BODY,
      tags: tags.length > 0 ? tags : ['Custom'],
      thumbnailUrl: thumb,
      referenceImageIds: imageIds,
      createdAt: editingSubject ? editingSubject.createdAt : Date.now(),
      updatedAt: Date.now(),
    };

    StorageService.saveProfile(profile);
    reloadAll();
    onSelectProfile(profile);
    setIsSubjectModalOpen(false);
  };

  const handleDeleteSubject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (profiles.length <= 1) return;
    StorageService.deleteProfile(id);
    reloadAll();
    const remaining = StorageService.getProfiles();
    if (activeProfileId === id && remaining.length > 0) {
      onSelectProfile(remaining[0]);
    }
  };

  // --- OUTFIT HANDLERS ---
  const handleOpenCreateOutfit = () => {
    setEditingOutfit(null);
    setOutfitName('');
    setOutfitDesc('');
    setOutfitGarment('');
    setOutfitColors('');
    setOutfitMaterials('');
    setOutfitFit('');
    setOutfitSleeves('');
    setOutfitNeckline('');
    setOutfitAccessories('');
    setOutfitFootwear('');
    setOutfitImage(null);
    setOutfitAnalysisError(null);
    setIsOutfitModalOpen(true);
  };

  const handleOpenEditOutfit = (o: MasterOutfit) => {
    setEditingOutfit(o);
    setOutfitName(o.name);
    setOutfitDesc(o.description);
    setOutfitGarment(o.garmentType || '');
    setOutfitColors(o.colors || '');
    setOutfitMaterials(o.materials || '');
    setOutfitFit(o.fit || '');
    setOutfitSleeves(o.sleeves || '');
    setOutfitNeckline(o.neckline || '');
    setOutfitAccessories(o.accessories || '');
    setOutfitFootwear(o.footwear || '');
    setOutfitImage(null);
    setOutfitAnalysisError(null);
    setIsOutfitModalOpen(true);
  };

  const handleOutfitImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const opt = await optimizeImageFile(file);
    setOutfitImage(opt);
    e.target.value = '';
  };

  const handleAnalyzeOutfitImage = async () => {
    if (!outfitImage) return;
    setIsAnalyzingOutfit(true);
    setOutfitAnalysisError(null);
    try {
      const customKey = StorageService.getCustomApiKey();
      const data = await postApiJson<any>(
        '/api/analyze-outfit-profile',
        {
          image: { data: outfitImage.data, mimeType: outfitImage.mimeType },
        },
        { customKey }
      );

      const out = data.outfit || {};
      if (!outfitName.trim() && out.suggestedName) setOutfitName(out.suggestedName);
      if (out.description) setOutfitDesc(out.description);
      if (out.garmentType) setOutfitGarment(out.garmentType);
      if (out.colors) setOutfitColors(out.colors);
      if (out.materials) setOutfitMaterials(out.materials);
      if (out.fit) setOutfitFit(out.fit);
      if (out.sleeves) setOutfitSleeves(out.sleeves);
      if (out.neckline) setOutfitNeckline(out.neckline);
      if (out.accessories) setOutfitAccessories(out.accessories);
      if (out.footwear) setOutfitFootwear(out.footwear);
    } catch (err: any) {
      setOutfitAnalysisError(
        extractApiErrorMessage(err, 'Could not analyze outfit image.')
      );
    } finally {
      setIsAnalyzingOutfit(false);
    }
  };

  const handleSaveOutfit = async () => {
    const finalName = outfitName.trim() || (outfitDesc.trim() ? `Outfit (${new Date().toLocaleDateString()})` : '');
    if (!finalName) {
      setOutfitAnalysisError('Please enter an Outfit Name or upload an outfit image to analyze.');
      return;
    }
    let thumb = editingOutfit?.thumbnailUrl;
    let imageId = editingOutfit?.imageId;
    if (outfitImage) {
      thumb = await createSmallThumbnail(outfitImage.previewUrl);
      await ImageDB.saveImage(outfitImage.id, outfitImage.previewUrl, outfitImage.mimeType);
      imageId = outfitImage.id;
    }

    const item: MasterOutfit = {
      id: editingOutfit ? editingOutfit.id : 'outfit_' + Date.now(),
      name: finalName,
      description: outfitDesc.trim() || `${finalName}.`,
      garmentType: outfitGarment.trim(),
      colors: outfitColors.trim(),
      materials: outfitMaterials.trim(),
      fit: outfitFit.trim(),
      sleeves: outfitSleeves.trim(),
      neckline: outfitNeckline.trim(),
      accessories: outfitAccessories.trim(),
      footwear: outfitFootwear.trim(),
      thumbnailUrl: thumb,
      imageId,
      createdAt: editingOutfit ? editingOutfit.createdAt : Date.now(),
      updatedAt: Date.now(),
    };

    StorageService.saveOutfit(item);
    reloadAll();
    if (onSelectOutfit) onSelectOutfit(item);
    setIsOutfitModalOpen(false);
  };

  const handleDeleteOutfit = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (outfits.length <= 1) return;
    StorageService.deleteOutfit(id);
    reloadAll();
  };

  // --- BACKGROUND HANDLERS ---
  const handleOpenCreateBg = () => {
    setEditingBg(null);
    setBgName('');
    setBgDesc('');
    setBgEnvironment('');
    setBgLighting('');
    setBgTags('Scene, Custom');
    setBgImage(null);
    setBgAnalysisError(null);
    setIsBgModalOpen(true);
  };

  const handleOpenEditBg = (b: BackgroundProfile) => {
    setEditingBg(b);
    setBgName(b.name);
    setBgDesc(b.background);
    setBgEnvironment(b.environment);
    setBgLighting(b.lighting);
    setBgTags((b.tags || []).join(', '));
    setBgImage(null);
    setBgAnalysisError(null);
    setIsBgModalOpen(true);
  };

  const handleBgImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const opt = await optimizeImageFile(file);
    setBgImage(opt);
    e.target.value = '';
  };

  const handleAnalyzeBgImage = async () => {
    if (!bgImage) return;
    setIsAnalyzingBg(true);
    setBgAnalysisError(null);
    try {
      const customKey = StorageService.getCustomApiKey();
      const data = await postApiJson<any>(
        '/api/analyze-background-profile',
        {
          image: { data: bgImage.data, mimeType: bgImage.mimeType },
        },
        { customKey }
      );

      const bp = data.backgroundProfile || {};
      if (!bgName.trim() && bp.suggestedName) setBgName(bp.suggestedName);
      if (bp.background) setBgDesc(bp.background);
      if (bp.environment) setBgEnvironment(bp.environment);
      if (bp.lighting) setBgLighting(bp.lighting);
      if (Array.isArray(bp.tags) && bp.tags.length > 0) {
        setBgTags(bp.tags.join(', '));
      }
    } catch (err: any) {
      setBgAnalysisError(
        extractApiErrorMessage(err, 'Could not analyze background image.')
      );
    } finally {
      setIsAnalyzingBg(false);
    }
  };

  const handleSaveBg = async () => {
    const finalName = bgName.trim() || (bgDesc.trim() ? `Background (${new Date().toLocaleDateString()})` : '');
    if (!finalName) {
      setBgAnalysisError('Please enter a Background Profile Name or upload a scene image to analyze.');
      return;
    }
    let thumb = editingBg?.thumbnailUrl;
    let imageId = editingBg?.imageId;
    if (bgImage) {
      thumb = await createSmallThumbnail(bgImage.previewUrl);
      await ImageDB.saveImage(bgImage.id, bgImage.previewUrl, bgImage.mimeType);
      imageId = bgImage.id;
    }

    const tags = bgTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const item: BackgroundProfile = {
      id: editingBg ? editingBg.id : 'bg_' + Date.now(),
      name: finalName,
      background: bgDesc.trim(),
      environment: bgEnvironment.trim(),
      lighting: bgLighting.trim(),
      tags: tags.length > 0 ? tags : ['Scene'],
      thumbnailUrl: thumb,
      imageId,
      createdAt: editingBg ? editingBg.createdAt : Date.now(),
      updatedAt: Date.now(),
    };

    StorageService.saveBackground(item);
    reloadAll();
    setIsBgModalOpen(false);
  };

  const handleDeleteBg = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    StorageService.deleteBackground(id);
    reloadAll();
  };

  // --- COMPONENT LIBRARY HANDLERS ---
  const handleOpenCreateComp = () => {
    setEditingComp(null);
    setCompKey('pose');
    setCompName('');
    setCompDesc('');
    setCompTags('');
    setIsCompModalOpen(true);
  };

  const handleOpenEditComp = (item: SavedComponentItem) => {
    setEditingComp(item);
    setCompKey(
      (item.componentKey in COMPONENT_LABELS ? item.componentKey : 'camera') as ComponentKey
    );
    setCompName(item.name);
    setCompDesc(item.description);
    setCompTags((item.tags || []).join(', '));
    setIsCompModalOpen(true);
  };

  const handleSaveComp = () => {
    if (!compDesc.trim()) return;
    const finalName = compName.trim() || `${COMPONENT_LABELS[compKey]} Preset`;
    const tags = compTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    StorageService.saveComponentItem({
      id: editingComp ? editingComp.id : `comp_${compKey}_${Date.now()}`,
      componentKey: compKey,
      name: finalName,
      description: compDesc.trim(),
      tags: tags.length > 0 ? tags : undefined,
      createdAt: editingComp ? editingComp.createdAt : Date.now(),
      updatedAt: Date.now(),
    });
    reloadAll();
    setIsCompModalOpen(false);
  };

  const handleDeleteComp = (id: string) => {
    StorageService.deleteComponentItem(id);
    reloadAll();
  };

  const filteredComponents =
    componentFilter === 'all'
      ? componentItems
      : componentItems.filter((c) => c.componentKey === componentFilter);

  return (
    <div className="space-y-6">
      {/* Sub-navigation bar for the 4 Profile Libraries */}
      <div className="glass-panel p-4 sm:p-5 rounded-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base sm:text-lg font-bold text-white tracking-tight">
              Reusable Visual Profiles Library
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Create and manage independent Subject, Outfit, Background, and Component presets stored locally on your device.
            </p>
          </div>

          <div>
            {activeSection === 'subjects' && (
              <button
                type="button"
                onClick={handleOpenCreateSubject}
                className="min-h-[40px] px-4 py-2 bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold rounded-xl transition flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>New Subject Profile</span>
              </button>
            )}
            {activeSection === 'outfits' && (
              <button
                type="button"
                onClick={handleOpenCreateOutfit}
                className="min-h-[40px] px-4 py-2 bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold rounded-xl transition flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>New Outfit Profile</span>
              </button>
            )}
            {activeSection === 'backgrounds' && (
              <button
                type="button"
                onClick={handleOpenCreateBg}
                className="min-h-[40px] px-4 py-2 bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold rounded-xl transition flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>New Background Profile</span>
              </button>
            )}
            {activeSection === 'components' && (
              <button
                type="button"
                onClick={handleOpenCreateComp}
                className="min-h-[40px] px-4 py-2 bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold rounded-xl transition flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>New Component Preset</span>
              </button>
            )}
          </div>
        </div>

        {/* Segmented Category Tabs with Spring Pill */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-black/40 border border-white/[0.08] rounded-xl">
          {(
            [
              { id: 'subjects', label: `Subjects (${profiles.length})`, icon: Users },
              { id: 'outfits', label: `Outfits (${outfits.length})`, icon: Shirt },
              { id: 'backgrounds', label: `Backgrounds (${backgrounds.length})`, icon: ImageIcon },
              { id: 'components', label: `Components (${componentItems.length})`, icon: Layers },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const isTabActive = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSection(tab.id)}
                className={`relative min-h-[40px] px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition whitespace-nowrap cursor-pointer ${
                  isTabActive ? 'text-black font-bold' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {isTabActive && (
                  <motion.div
                    layoutId="profileSectionPill"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-lg bg-[#f5c518]"
                  />
                )}
                <Icon className="relative z-10 w-3.5 h-3.5" />
                <span className="relative z-10 font-mono tabular-nums">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* SECTION A: SUBJECT PROFILES */}
      {activeSection === 'subjects' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {profiles.map((p) => {
            const isActive = p.id === activeProfileId;
            return (
              <div
                key={p.id}
                onClick={() => onSelectProfile(p)}
                className={`group rounded-2xl p-5 transition-all cursor-pointer flex flex-col justify-between ${
                  isActive ? 'glass-card-active' : 'glass-card hover:border-white/20'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <h3 className="font-display text-sm font-bold text-white group-hover:text-[#f5c518] transition truncate">
                        {p.name}
                      </h3>
                      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mt-0.5">
                        <span>{isActive ? 'Default Active Subject' : 'Click to set default'}</span>
                        {(p.tags || []).length > 0 && (
                          <>
                            <span>·</span>
                            <span className="truncate">{(p.tags || []).join(' · ')}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {p.thumbnailUrl && (
                      <img
                        src={p.thumbnailUrl}
                        alt={p.name}
                        referrerPolicy="no-referrer"
                        className="w-12 h-12 rounded-xl object-cover border border-[#262a36] shrink-0"
                      />
                    )}
                  </div>

                  <p className="text-xs text-zinc-300 line-clamp-3 leading-relaxed mt-2 mb-3">
                    {p.masterSubject}
                  </p>
                </div>

                <div
                  className="pt-3 border-t border-[#1f232d] flex items-center justify-between text-xs text-zinc-400"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-[11px] text-zinc-500 tabular-nums">
                    Updated {new Date(p.updatedAt).toLocaleDateString()}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Edit Subject Profile"
                      onClick={() => handleOpenEditSubject(p)}
                      className="p-1.5 rounded-lg hover:bg-[#202430] hover:text-white transition"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Duplicate Subject Profile"
                      onClick={() => {
                        StorageService.saveProfile({
                          ...p,
                          id: 'profile_' + Date.now(),
                          name: `${p.name} (Copy)`,
                          createdAt: Date.now(),
                          updatedAt: Date.now(),
                        });
                        reloadAll();
                      }}
                      className="p-1.5 rounded-lg hover:bg-[#202430] hover:text-white transition"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    {profiles.length > 1 && (
                      <button
                        type="button"
                        title="Delete Subject Profile"
                        onClick={(e) => handleDeleteSubject(p.id, e)}
                        className="p-1.5 rounded-lg hover:bg-red-950/60 hover:text-red-400 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SECTION B: OUTFIT PROFILES */}
      {activeSection === 'outfits' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {outfits.map((o) => {
            const isActive = o.id === activeOutfitId;
            return (
              <div
                key={o.id}
                onClick={() => onSelectOutfit && onSelectOutfit(o)}
                className={`group rounded-2xl p-5 border transition-all cursor-pointer flex flex-col justify-between ${
                  isActive
                    ? 'bg-[#151822] border-[#f5c518]'
                    : 'bg-[#11131a] border-[#262a36] hover:border-[#3a4052]'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-white group-hover:text-[#f5c518] transition truncate">
                        {o.name}
                      </h3>
                      <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                        {o.garmentType || 'Reusable Outfit Specification'}
                      </div>
                    </div>
                    {o.thumbnailUrl && (
                      <img
                        src={o.thumbnailUrl}
                        alt={o.name}
                        referrerPolicy="no-referrer"
                        className="w-12 h-12 rounded-xl object-cover border border-[#262a36] shrink-0"
                      />
                    )}
                  </div>

                  <p className="text-xs text-zinc-300 line-clamp-3 leading-relaxed mt-2 mb-3">
                    {o.description}
                  </p>
                </div>

                <div
                  className="pt-3 border-t border-[#1f232d] flex items-center justify-between text-xs text-zinc-400"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-[11px] text-zinc-500 tabular-nums">
                    Updated {new Date(o.updatedAt).toLocaleDateString()}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Edit Outfit Profile"
                      onClick={() => handleOpenEditOutfit(o)}
                      className="p-1.5 rounded-lg hover:bg-[#202430] hover:text-white transition"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Duplicate Outfit Profile"
                      onClick={() => {
                        StorageService.saveOutfit({
                          ...o,
                          id: 'outfit_' + Date.now(),
                          name: `${o.name} (Copy)`,
                          createdAt: Date.now(),
                          updatedAt: Date.now(),
                        });
                        reloadAll();
                      }}
                      className="p-1.5 rounded-lg hover:bg-[#202430] hover:text-white transition"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    {outfits.length > 1 && (
                      <button
                        type="button"
                        title="Delete Outfit Profile"
                        onClick={(e) => handleDeleteOutfit(o.id, e)}
                        className="p-1.5 rounded-lg hover:bg-red-950/60 hover:text-red-400 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SECTION C: BACKGROUND PROFILES */}
      {activeSection === 'backgrounds' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {backgrounds.map((b) => (
            <div
              key={b.id}
              className="rounded-2xl p-5 bg-[#11131a] border border-[#262a36] hover:border-[#3a4052] transition flex flex-col justify-between space-y-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white">{b.name}</h3>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      {(b.tags || []).join(' · ') || 'Background · Environment · Lighting'}
                    </div>
                  </div>
                  {b.thumbnailUrl && (
                    <img
                      src={b.thumbnailUrl}
                      alt={b.name}
                      referrerPolicy="no-referrer"
                      className="w-14 h-14 rounded-xl object-cover border border-[#262a36] shrink-0"
                    />
                  )}
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-zinc-500 font-semibold">Background: </span>
                    <span className="text-zinc-300 line-clamp-2">{b.background}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 font-semibold">Environment: </span>
                    <span className="text-zinc-300 line-clamp-2">{b.environment}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 font-semibold">Lighting: </span>
                    <span className="text-zinc-300 line-clamp-2">{b.lighting}</span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-[#1f232d] flex items-center justify-between text-xs text-zinc-400">
                <span className="text-[11px] text-zinc-500 tabular-nums">
                  Updated {new Date(b.updatedAt).toLocaleDateString()}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenEditBg(b)}
                    className="p-1.5 rounded-lg hover:bg-[#202430] hover:text-white transition"
                    title="Edit Background Profile"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Duplicate Background Profile"
                    onClick={() => {
                      StorageService.saveBackground({
                        ...b,
                        id: 'bg_' + Date.now(),
                        name: `${b.name} (Copy)`,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                      });
                      reloadAll();
                    }}
                    className="p-1.5 rounded-lg hover:bg-[#202430] hover:text-white transition"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteBg(b.id, e)}
                    className="p-1.5 rounded-lg hover:bg-red-950/60 hover:text-red-400 transition"
                    title="Delete Background Profile"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SECTION D: COMPONENT LIBRARY */}
      {activeSection === 'components' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setComponentFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                componentFilter === 'all'
                  ? 'bg-[#f5c518] text-black font-bold'
                  : 'bg-[#161922] text-zinc-400 hover:text-white border border-[#262a36]'
              }`}
            >
              All Components
            </button>
            {ALL_COMPONENT_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setComponentFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  componentFilter === key
                    ? 'bg-[#f5c518] text-black font-bold'
                    : 'bg-[#161922] text-zinc-400 hover:text-white border border-[#262a36]'
                }`}
              >
                {COMPONENT_LABELS[key]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredComponents.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl p-4 bg-[#11131a] border border-[#262a36] flex flex-col justify-between space-y-3"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-white">{item.name}</span>
                    <span className="text-[11px] text-[#f5c518] font-medium">
                      {COMPONENT_LABELS[item.componentKey as ComponentKey] ||
                        CAMERA_COMPONENT_LABELS[item.componentKey as CameraComponentKey]?.label ||
                        item.componentKey}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed mt-2">{item.description}</p>
                </div>

                <div className="pt-2.5 border-t border-[#1f232d] flex items-center justify-between text-[11px] text-zinc-500">
                  <span className="tabular-nums">
                    Saved {new Date(item.updatedAt).toLocaleDateString()}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenEditComp(item)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-[#202430]"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteComp(item.id)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-950/50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL 1: SUBJECT PROFILE (Up to 5 reference images) */}
      {isSubjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-[#11131a] border border-[#262a36] rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#1f232d] pb-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingSubject ? 'Edit Subject Profile' : 'Create Subject Profile'}
                </h3>
                <p className="text-xs text-zinc-400">
                  Upload up to 5 reference images of the same subject to extract a consolidated visual identity.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSubjectModalOpen(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Multi-Image Reference Uploader (Up to 5 images) */}
            <div className="p-4 rounded-xl bg-[#161922] border border-[#262a36] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">
                  Subject Reference Images ({subjectImages.length}/5)
                </span>
                <input
                  type="file"
                  ref={subjectFileInputRef}
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleSubjectImageSelect}
                />
                {subjectImages.length < 5 && (
                  <button
                    type="button"
                    onClick={() => subjectFileInputRef.current?.click()}
                    className="text-xs font-bold text-[#f5c518] hover:underline flex items-center gap-1"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Photos (Max 5)</span>
                  </button>
                )}
              </div>

              {subjectImages.length > 0 && (
                <div className="grid grid-cols-5 gap-2">
                  {subjectImages.map((img) => (
                    <div
                      key={img.id}
                      className="relative aspect-square rounded-lg overflow-hidden bg-black border border-[#2e3446]"
                    >
                      <img
                        src={img.previewUrl}
                        alt="Subject ref"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setSubjectImages((prev) => prev.filter((i) => i.id !== img.id))
                        }
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/80 text-white text-xs flex items-center justify-center"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {subjectImages.length > 0 && (
                <button
                  type="button"
                  disabled={isAnalyzingSubject}
                  onClick={handleAnalyzeSubjectImages}
                  className="w-full py-2.5 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  {isAnalyzingSubject ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Consolidating Subject Identity Across {subjectImages.length} Image(s)...</span>
                    </>
                  ) : (
                    <span>Analyze & Consolidate Subject Description</span>
                  )}
                </button>
              )}

              {subjectAnalysisError && (
                <p className="text-xs text-red-400">{subjectAnalysisError}</p>
              )}
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Subject Profile Name *
                  </label>
                  <input
                    type="text"
                    value={subjectName}
                    onChange={(e) => setSubjectName(e.target.value)}
                    placeholder="e.g. Studio Identity A"
                    className="w-full bg-[#181b24] border border-[#262a36] focus:border-[#f5c518] text-white px-3.5 py-2 rounded-xl text-xs outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Keywords (comma separated)
                  </label>
                  <input
                    type="text"
                    value={subjectTags}
                    onChange={(e) => setSubjectTags(e.target.value)}
                    placeholder="e.g. Portrait, Realistic"
                    className="w-full bg-[#181b24] border border-[#262a36] focus:border-[#f5c518] text-white px-3.5 py-2 rounded-xl text-xs outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-white mb-1">
                  Consolidated Subject Identity Description *
                </label>
                <textarea
                  value={subjectText}
                  onChange={(e) => setSubjectText(e.target.value)}
                  rows={5}
                  className="w-full bg-[#181b24] border border-[#262a36] focus:border-[#f5c518] text-white p-3 rounded-xl text-xs leading-relaxed outline-none"
                  placeholder="Apparent age range, skin tone, facial structure, eyes, eyebrows, nose, lips, hair texture, and distinguishing marks..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-white mb-1">
                  Body Proportions & Build Description (Independent)
                </label>
                <textarea
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  rows={4}
                  className="w-full bg-[#181b24] border border-[#262a36] focus:border-[#f5c518] text-white p-3 rounded-xl text-xs leading-relaxed outline-none"
                  placeholder="Body proportions, silhouette, build, and anatomical geometry..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1f232d]">
              <button
                type="button"
                onClick={() => setIsSubjectModalOpen(false)}
                className="px-4 py-2 text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSubject}
                className="px-4 py-2 bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold rounded-xl"
              >
                Save Subject Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: OUTFIT PROFILE (With Image Analyzer) */}
      {isOutfitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-[#11131a] border border-[#262a36] rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#1f232d] pb-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingOutfit ? 'Edit Outfit Profile' : 'Create Outfit Profile'}
                </h3>
                <p className="text-xs text-zinc-400">
                  Upload an outfit reference image to extract clothing details or write your own reusable outfit specification.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOutfitModalOpen(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Outfit Reference Image Analyzer */}
            <div className="p-4 rounded-xl bg-[#161922] border border-[#262a36] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Outfit Reference Image</span>
                <input
                  type="file"
                  ref={outfitFileInputRef}
                  accept="image/*"
                  className="hidden"
                  onChange={handleOutfitImageSelect}
                />
                <button
                  type="button"
                  onClick={() => outfitFileInputRef.current?.click()}
                  className="text-xs font-bold text-[#f5c518] hover:underline flex items-center gap-1"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{outfitImage ? 'Change Image' : 'Upload Outfit Image'}</span>
                </button>
              </div>

              {outfitImage && (
                <div className="flex items-center gap-3">
                  <img
                    src={outfitImage.previewUrl}
                    alt="Outfit ref"
                    className="w-16 h-16 rounded-lg object-cover border border-[#2e3446]"
                  />
                  <button
                    type="button"
                    disabled={isAnalyzingOutfit}
                    onClick={handleAnalyzeOutfitImage}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs flex items-center justify-center gap-2 transition disabled:opacity-50"
                  >
                    {isAnalyzingOutfit ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Analyzing Visible Garments & Fabrics...</span>
                      </>
                    ) : (
                      <span>Analyze Outfit Reference</span>
                    )}
                  </button>
                </div>
              )}
              {outfitAnalysisError && (
                <p className="text-xs text-red-400">{outfitAnalysisError}</p>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Outfit Name *
                </label>
                <input
                  type="text"
                  value={outfitName}
                  onChange={(e) => setOutfitName(e.target.value)}
                  placeholder="e.g. Tailored Linen Blazer & Silk Camisole"
                  className="w-full bg-[#181b24] border border-[#262a36] focus:border-[#f5c518] text-white px-3.5 py-2 rounded-xl text-xs outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={outfitGarment}
                  onChange={(e) => setOutfitGarment(e.target.value)}
                  placeholder="Garment categories"
                  className="bg-[#181b24] border border-[#262a36] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#f5c518]"
                />
                <input
                  type="text"
                  value={outfitColors}
                  onChange={(e) => setOutfitColors(e.target.value)}
                  placeholder="Colors & patterns"
                  className="bg-[#181b24] border border-[#262a36] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#f5c518]"
                />
                <input
                  type="text"
                  value={outfitMaterials}
                  onChange={(e) => setOutfitMaterials(e.target.value)}
                  placeholder="Fabrics & textures"
                  className="bg-[#181b24] border border-[#262a36] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#f5c518]"
                />
                <input
                  type="text"
                  value={outfitFit}
                  onChange={(e) => setOutfitFit(e.target.value)}
                  placeholder="Fit, drape & construction"
                  className="bg-[#181b24] border border-[#262a36] rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#f5c518]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-white mb-1">
                  Complete Outfit Description (Source of Truth for Clothing Field) *
                </label>
                <textarea
                  value={outfitDesc}
                  onChange={(e) => setOutfitDesc(e.target.value)}
                  rows={4}
                  className="w-full bg-[#181b24] border border-[#262a36] focus:border-[#f5c518] text-white p-3 rounded-xl text-xs leading-relaxed outline-none"
                  placeholder="Detailed description of visible garments, colors, fabrics, fit, neckline, sleeves, hems, accessories, and footwear..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1f232d]">
              <button
                type="button"
                onClick={() => setIsOutfitModalOpen(false)}
                className="px-4 py-2 text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveOutfit}
                className="px-4 py-2 bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold rounded-xl"
              >
                Save Outfit Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: BACKGROUND PROFILE (With Image Analyzer for Background, Environment, Lighting) */}
      {isBgModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-[#11131a] border border-[#262a36] rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#1f232d] pb-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingBg ? 'Edit Background Profile' : 'Create Background Profile'}
                </h3>
                <p className="text-xs text-zinc-400">
                  Upload a scene reference image to extract independent Background, Environment, and Lighting descriptions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsBgModalOpen(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Background Image Analyzer */}
            <div className="p-4 rounded-xl bg-[#161922] border border-[#262a36] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Background Reference Image</span>
                <input
                  type="file"
                  ref={bgFileInputRef}
                  accept="image/*"
                  className="hidden"
                  onChange={handleBgImageSelect}
                />
                <button
                  type="button"
                  onClick={() => bgFileInputRef.current?.click()}
                  className="text-xs font-bold text-[#f5c518] hover:underline flex items-center gap-1"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{bgImage ? 'Change Image' : 'Upload Scene Image'}</span>
                </button>
              </div>

              {bgImage && (
                <div className="flex items-center gap-3">
                  <img
                    src={bgImage.previewUrl}
                    alt="Background ref"
                    className="w-16 h-16 rounded-lg object-cover border border-[#2e3446]"
                  />
                  <button
                    type="button"
                    disabled={isAnalyzingBg}
                    onClick={handleAnalyzeBgImage}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs flex items-center justify-center gap-2 transition disabled:opacity-50"
                  >
                    {isAnalyzingBg ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Extracting Background, Environment & Lighting...</span>
                      </>
                    ) : (
                      <span>Analyze Scene Reference</span>
                    )}
                  </button>
                </div>
              )}
              {bgAnalysisError && <p className="text-xs text-red-400">{bgAnalysisError}</p>}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Background Profile Name *
                </label>
                <input
                  type="text"
                  value={bgName}
                  onChange={(e) => setBgName(e.target.value)}
                  placeholder="e.g. Sunlit Concrete Studio Loft"
                  className="w-full bg-[#181b24] border border-[#262a36] focus:border-[#f5c518] text-white px-3.5 py-2 rounded-xl text-xs outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-white mb-1">
                  1. Background Description (Objects, Surfaces, Textures, Depth)
                </label>
                <textarea
                  value={bgDesc}
                  onChange={(e) => setBgDesc(e.target.value)}
                  rows={3}
                  className="w-full bg-[#181b24] border border-[#262a36] focus:border-[#f5c518] text-white p-3 rounded-xl text-xs leading-relaxed outline-none"
                  placeholder="Describe visible background structures, surfaces, colors, textures, and depth..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-white mb-1">
                  2. Environment & Setting Context
                </label>
                <textarea
                  value={bgEnvironment}
                  onChange={(e) => setBgEnvironment(e.target.value)}
                  rows={3}
                  className="w-full bg-[#181b24] border border-[#262a36] focus:border-[#f5c518] text-white p-3 rounded-xl text-xs leading-relaxed outline-none"
                  placeholder="Describe indoor/outdoor setting, architectural context, atmosphere, or weather conditions..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-white mb-1">
                  3. Lighting Characteristics
                </label>
                <textarea
                  value={bgLighting}
                  onChange={(e) => setBgLighting(e.target.value)}
                  rows={3}
                  className="w-full bg-[#181b24] border border-[#262a36] focus:border-[#f5c518] text-white p-3 rounded-xl text-xs leading-relaxed outline-none"
                  placeholder="Describe apparent light sources, direction, softness, color temperature, highlights, and shadows..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1f232d]">
              <button
                type="button"
                onClick={() => setIsBgModalOpen(false)}
                className="px-4 py-2 text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveBg}
                className="px-4 py-2 bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold rounded-xl"
              >
                Save Background Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: COMPONENT PRESET LIBRARY */}
      {isCompModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[#11131a] border border-[#262a36] rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#1f232d] pb-3">
              <h3 className="text-base font-bold text-white">
                {editingComp ? 'Edit Component Preset' : 'New Component Preset'}
              </h3>
              <button
                type="button"
                onClick={() => setIsCompModalOpen(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Component Category
                </label>
                <select
                  value={compKey}
                  onChange={(e) => setCompKey(e.target.value as ComponentKey)}
                  className="w-full bg-[#181b24] border border-[#262a36] focus:border-[#f5c518] text-white px-3.5 py-2 rounded-xl text-xs outline-none"
                >
                  {ALL_COMPONENT_KEYS.map((k) => (
                    <option key={k} value={k} className="bg-[#141722] text-white">
                      {COMPONENT_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Preset Name *
                </label>
                <input
                  type="text"
                  value={compName}
                  onChange={(e) => setCompName(e.target.value)}
                  placeholder="e.g. Low-Angle Three-Quarter Perspective"
                  className="w-full bg-[#181b24] border border-[#262a36] focus:border-[#f5c518] text-white px-3.5 py-2 rounded-xl text-xs outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-white mb-1">
                  Component Description *
                </label>
                <textarea
                  value={compDesc}
                  onChange={(e) => setCompDesc(e.target.value)}
                  rows={4}
                  className="w-full bg-[#181b24] border border-[#262a36] focus:border-[#f5c518] text-white p-3 rounded-xl text-xs leading-relaxed outline-none"
                  placeholder="Detailed description for this reusable component..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1f232d]">
              <button
                type="button"
                onClick={() => setIsCompModalOpen(false)}
                className="px-4 py-2 text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveComp}
                className="px-4 py-2 bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold rounded-xl"
              >
                Save Component Preset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
