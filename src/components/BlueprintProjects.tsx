import React, { useState } from 'react';
import { ReferenceBlueprint, ToolType } from '../types';
import { StorageService } from '../services/storage';
import { sanitizeProductionPrompt } from '../services/promptBuilder';
import {
  FolderKanban,
  Download,
  Copy,
  Trash2,
  ExternalLink,
  Layers,
  Check,
  Search,
  Edit2,
  Files,
  X,
} from 'lucide-react';

interface BlueprintProjectsProps {
  onLoadBlueprint: (blueprint: ReferenceBlueprint) => void;
}

const TOOL_LABELS: Record<ToolType, string> = {
  general_extractor: 'General Prompt Extractor',
  subject_swapping: 'Subject Swapping',
  camera_controller: 'Camera Angle Controller',
};

export const BlueprintProjects: React.FC<BlueprintProjectsProps> = ({ onLoadBlueprint }) => {
  const [blueprints, setBlueprints] = useState<ReferenceBlueprint[]>(() =>
    StorageService.getBlueprints()
  );
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const reloadBlueprints = () => {
    setBlueprints(StorageService.getBlueprints());
  };

  const filtered = blueprints.filter(
    (b) =>
      b.title.toLowerCase().includes(search.toLowerCase()) ||
      b.finalPrompt.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    StorageService.deleteBlueprint(id);
    reloadBlueprints();
  };

  const handleStartRename = (b: ReferenceBlueprint, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(b.id);
    setRenameText(b.title);
  };

  const handleConfirmRename = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (renameText.trim()) {
      StorageService.renameBlueprint(id, renameText.trim());
      reloadBlueprints();
    }
    setRenamingId(null);
  };

  const handleDuplicate = (b: ReferenceBlueprint, e: React.MouseEvent) => {
    e.stopPropagation();
    const copy: ReferenceBlueprint = {
      ...b,
      id: 'blueprint_' + Date.now(),
      title: `${b.title} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    StorageService.saveBlueprint(copy);
    reloadBlueprints();
  };

  const handleCopyPrompt = (id: string, promptText: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const cleanPrompt = sanitizeProductionPrompt(promptText);
    navigator.clipboard.writeText(cleanPrompt);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownloadPrompt = (blueprint: ReferenceBlueprint, e: React.MouseEvent) => {
    e.stopPropagation();
    const cleanPrompt = sanitizeProductionPrompt(blueprint.finalPrompt);
    const blob = new Blob([cleanPrompt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${blueprint.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_prompt.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 glass-panel p-5 rounded-2xl">
        <div>
          <div className="flex items-center gap-2">
            <FolderKanban className="w-5 h-5 text-[#f5c518]" />
            <h2 className="font-display text-base font-bold text-white tracking-tight">
              Saved Projects & Blueprints
            </h2>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Your analyzed 13-component blueprints, camera setups, and generated prompts stored locally on your device.
          </p>
        </div>

        {blueprints.length > 0 && (
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects..."
              className="w-full bg-black/40 border border-white/15 focus:border-[#f5c518] text-white pl-8 pr-3 py-1.5 rounded-xl text-xs outline-none"
            />
          </div>
        )}
      </div>

      {/* Blueprint list */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 glass-panel p-12 text-center flex flex-col items-center justify-center">
          <Layers className="w-10 h-10 text-zinc-600 mb-3" />
          <h3 className="font-display text-sm font-bold text-zinc-300">No Saved Projects Found</h3>
          <p className="text-xs text-zinc-500 max-w-sm mt-1">
            Analyze an image in Tools, customize your 13 components or camera perspective, and click "Save Project" to store it here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((b) => {
            const isCameraProject =
              b.toolType === 'camera_controller' && Boolean(b.cameraReferenceState);
            const lockedCount = isCameraProject
              ? Object.values(b.cameraReferenceState?.components || {}).filter(
                  (c) => c.state === 'locked' || c.state === 'edited'
                ).length
              : Object.values(b.components || {}).filter(
                  (c) => c.state === 'locked' || c.state === 'edited'
                ).length;
            const toolLabel = b.toolType ? TOOL_LABELS[b.toolType] : 'General Prompt Extractor';

            return (
              <div
                key={b.id}
                onClick={() => onLoadBlueprint(b)}
                className="group rounded-2xl glass-card hover:border-[#f5c518]/40 p-5 transition-all cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      {renamingId === b.id ? (
                        <div
                          className="flex items-center gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={renameText}
                            onChange={(e) => setRenameText(e.target.value)}
                            className="bg-black/60 border border-[#f5c518] rounded-lg px-2.5 py-1 text-xs text-white outline-none w-full"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={(e) => handleConfirmRename(b.id, e)}
                            className="p-1.5 rounded-lg bg-[#f5c518] text-black font-bold text-xs"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingId(null);
                            }}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-white"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <h3 className="font-display text-sm font-bold text-white group-hover:text-[#f5c518] transition truncate">
                          {b.title}
                        </h3>
                      )}

                      <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] font-mono text-zinc-400 tabular-nums">
                        <span className="text-[#f5c518] font-medium">{toolLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {new Date(b.updatedAt || b.createdAt).toLocaleDateString()}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Ratio {b.outputRatio}</span>
                        <span aria-hidden="true">·</span>
                        <span>{lockedCount} Active</span>
                      </div>
                    </div>

                    {b.referenceThumbnails?.[0] && (
                      <div className="w-14 h-14 rounded-xl overflow-hidden bg-black border border-white/15 shrink-0">
                        <img
                          src={b.referenceThumbnails[0]}
                          alt="Thumbnail"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-zinc-300 font-mono line-clamp-3 bg-black/50 p-3 rounded-xl border border-white/[0.07] my-3 leading-relaxed">
                    {b.finalPrompt || 'No final prompt generated yet — click Load Project to continue editing.'}
                  </p>
                </div>

                <div
                  className="pt-3 border-t border-white/[0.07] flex items-center justify-between text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onLoadBlueprint(b)}
                    className="flex items-center gap-1.5 text-[#f5c518] hover:text-[#ffe169] font-bold text-xs"
                  >
                    <span>Open Project</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Rename Project"
                      onClick={(e) => handleStartRename(b, e)}
                      className="p-1.5 rounded-lg hover:bg-[#202430] text-zinc-400 hover:text-white transition"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      title="Duplicate Project"
                      onClick={(e) => handleDuplicate(b, e)}
                      className="p-1.5 rounded-lg hover:bg-[#202430] text-zinc-400 hover:text-white transition"
                    >
                      <Files className="w-3.5 h-3.5" />
                    </button>

                    {b.finalPrompt && (
                      <>
                        <button
                          type="button"
                          title="Copy Final Prompt"
                          onClick={(e) => handleCopyPrompt(b.id, b.finalPrompt, e)}
                          className="p-1.5 rounded-lg hover:bg-[#202430] text-zinc-400 hover:text-white transition"
                        >
                          {copiedId === b.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          title="Download Prompt (.txt)"
                          onClick={(e) => handleDownloadPrompt(b, e)}
                          className="p-1.5 rounded-lg hover:bg-[#202430] text-zinc-400 hover:text-white transition"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      title="Delete Project"
                      onClick={(e) => handleDelete(b.id, e)}
                      className="p-1.5 rounded-lg hover:bg-red-950/60 text-zinc-400 hover:text-red-400 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

