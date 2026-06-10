import { Injectable } from "@nestjs/common";
import { execSync } from "node:child_process";
import * as os from "node:os";

export interface SystemInfo {
  os: string;
  arch: string;
  cpuCount: number;
  cpuModel: string;
  ramGb: number;
  /** Memory free right now (macOS counts cache as used, so this runs low). */
  freeGb: number;
  vramGb: number | null;
  gpuName: string | null;
  /** True on Apple Silicon: GPU shares system RAM (no separate VRAM). */
  unifiedMemory: boolean;
  /** GPU acceleration backend the model engine will use, if any. */
  accelerator: string | null;
  /** Memory budget (GB) we can realistically give a model on this machine. */
  usableGb: number;
  detectionMethod: string;
}

type ModelTag = "general" | "reasoning" | "code" | "vision";

/** A curated slice of Ollama's library across families and sizes. `memGb` is
 *  approx RUNTIME memory (Q4 weights + a working context); `size` is the
 *  download. The recommender picks a diverse set of these that fit the machine,
 *  so different hardware surfaces genuinely different models. */
interface CatalogModel { modelId: string; label: string; memGb: number; size: string; tag: ModelTag; blurb: string }

const CATALOG: CatalogModel[] = [
  // ── tiny / very fast ─────────────────────────────────────────────
  { modelId: "qwen2.5:0.5b",        label: "Qwen 2.5 0.5B",        memGb: 1.5, size: "~0.4 GB", tag: "general",   blurb: "Ultra-light, instant replies" },
  { modelId: "deepseek-r1:1.5b",    label: "DeepSeek-R1 1.5B",     memGb: 2,   size: "~1.1 GB", tag: "reasoning", blurb: "Tiny step-by-step reasoner" },
  { modelId: "qwen2.5-coder:1.5b",  label: "Qwen2.5-Coder 1.5B",   memGb: 2,   size: "~1 GB",   tag: "code",      blurb: "Lightweight coding model" },
  { modelId: "llama3.2:1b",         label: "Llama 3.2 1B",         memGb: 2,   size: "~1.3 GB", tag: "general",   blurb: "Tiny and quick" },
  { modelId: "gemma2:2b",           label: "Gemma 2 2B",           memGb: 2.5, size: "~1.6 GB", tag: "general",   blurb: "Google's compact model" },
  // ── 3–4B ─────────────────────────────────────────────────────────
  { modelId: "llama3.2:3b",         label: "Llama 3.2 3B",         memGb: 4,   size: "~2 GB",   tag: "general",   blurb: "Fast, capable all-rounder" },
  { modelId: "qwen2.5:3b",          label: "Qwen 2.5 3B",          memGb: 4,   size: "~1.9 GB", tag: "general",   blurb: "Strong small general model" },
  { modelId: "phi3:3.8b",           label: "Phi-3 3.8B",           memGb: 4.5, size: "~2.2 GB", tag: "general",   blurb: "Microsoft's efficient model" },
  // ── 7–9B ─────────────────────────────────────────────────────────
  { modelId: "mistral:7b",          label: "Mistral 7B",           memGb: 6,   size: "~4.4 GB", tag: "general",   blurb: "Popular, well-rounded" },
  { modelId: "qwen2.5:7b",          label: "Qwen 2.5 7B",          memGb: 6,   size: "~4.7 GB", tag: "general",   blurb: "Excellent quality for its size" },
  { modelId: "qwen2.5-coder:7b",    label: "Qwen2.5-Coder 7B",     memGb: 6,   size: "~4.7 GB", tag: "code",      blurb: "Great for writing code" },
  { modelId: "deepseek-r1:8b",      label: "DeepSeek-R1 8B",       memGb: 6.5, size: "~4.9 GB", tag: "reasoning", blurb: "Strong reasoning at 8B" },
  { modelId: "llama3.1:8b",         label: "Llama 3.1 8B",         memGb: 6.5, size: "~4.9 GB", tag: "general",   blurb: "Meta's solid all-rounder" },
  { modelId: "llama3.2-vision:11b", label: "Llama 3.2 Vision 11B", memGb: 9,   size: "~7.8 GB", tag: "vision",    blurb: "Understands images" },
  { modelId: "gemma2:9b",           label: "Gemma 2 9B",           memGb: 8,   size: "~5.4 GB", tag: "general",   blurb: "High-quality Google model" },
  // ── 12–16B ───────────────────────────────────────────────────────
  { modelId: "mistral-nemo:12b",    label: "Mistral Nemo 12B",     memGb: 9,   size: "~7 GB",   tag: "general",   blurb: "Long-context general model" },
  { modelId: "qwen2.5:14b",         label: "Qwen 2.5 14B",         memGb: 11,  size: "~9 GB",   tag: "general",   blurb: "Top quality-to-speed balance" },
  { modelId: "phi4:14b",            label: "Phi-4 14B",            memGb: 11,  size: "~9 GB",   tag: "general",   blurb: "Microsoft's strong 14B" },
  { modelId: "deepseek-r1:14b",     label: "DeepSeek-R1 14B",      memGb: 11,  size: "~9 GB",   tag: "reasoning", blurb: "Strong reasoning at 14B" },
  { modelId: "qwen2.5-coder:14b",   label: "Qwen2.5-Coder 14B",    memGb: 11,  size: "~9 GB",   tag: "code",      blurb: "Excellent local coding model" },
  // ── 27–32B ───────────────────────────────────────────────────────
  { modelId: "gemma2:27b",          label: "Gemma 2 27B",          memGb: 18,  size: "~16 GB",  tag: "general",   blurb: "Large, high-quality Google model" },
  { modelId: "qwq:32b",             label: "QwQ 32B",              memGb: 22,  size: "~20 GB",  tag: "reasoning", blurb: "Reasoning-focused 32B" },
  { modelId: "qwen2.5:32b",         label: "Qwen 2.5 32B",         memGb: 22,  size: "~20 GB",  tag: "general",   blurb: "Top-tier reasoning, heavy" },
  { modelId: "qwen2.5-coder:32b",   label: "Qwen2.5-Coder 32B",    memGb: 22,  size: "~20 GB",  tag: "code",      blurb: "Best local coding model" },
  // ── 70B+ ─────────────────────────────────────────────────────────
  { modelId: "llama3.3:70b",        label: "Llama 3.3 70B",        memGb: 43,  size: "~43 GB",  tag: "general",   blurb: "Frontier-class, very heavy" },
  { modelId: "qwen2.5:72b",         label: "Qwen 2.5 72B",         memGb: 47,  size: "~47 GB",  tag: "general",   blurb: "Largest general model" },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.modelId, m]));
export function modelSize(id: string): string | null {
  return CATALOG_BY_ID.get(id)?.size ?? null;
}

export interface ModelRecommendation {
  modelId: string;
  label: string;
  reason: string;
  size: string | null;
  vramRequired: number | null;
  alternatives: { modelId: string; label: string; note: string; size: string | null }[];
  alreadyInstalled: boolean;
}

@Injectable()
export class SystemService {
  /** Detect system hardware. Never throws — returns partial info on errors. */
  async getSystemInfo(): Promise<SystemInfo> {
    const cpus = os.cpus();
    const base = {
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model ?? "Unknown",
      ramGb: Math.round(os.totalmem() / 1e9),
      freeGb: Math.round(os.freemem() / 1e9),
    };

    // Apple Silicon: unified memory + Metal GPU (no separate VRAM to detect).
    const gpu =
      process.platform === "darwin" && os.arch() === "arm64"
        ? {
            gpuName: base.cpuModel, // e.g. "Apple M1 Pro" — the chip is the GPU
            vramGb: null,
            unifiedMemory: true,
            accelerator: "Metal" as string | null,
            detectionMethod: "apple-silicon",
          }
        : { unifiedMemory: false, ...this.detectGpu() };

    const partial = { ...base, ...gpu } as Omit<SystemInfo, "usableGb">;
    return { ...partial, usableGb: this.usableBudget(partial) };
  }

  /**
   * How much memory we can realistically dedicate to a model on this machine.
   *  - Dedicated GPU → its VRAM.
   *  - Apple Silicon → ~60% of unified RAM (the rest for macOS + apps).
   *  - CPU-only → ~50% of RAM.
   * macOS reports very little "free" memory (it caches aggressively and reclaims
   * on demand), so the budget is total-based; free memory is surfaced separately
   * as a live-pressure hint rather than driving the pick.
   */
  private usableBudget(info: Omit<SystemInfo, "usableGb">): number {
    if (info.vramGb != null) return info.vramGb;
    return Math.max(2, Math.round(info.ramGb * 0.5));
  }

  private detectGpu(): Pick<SystemInfo, "vramGb" | "gpuName" | "accelerator" | "detectionMethod"> {
    // 1. NVIDIA via nvidia-smi
    try {
      const raw = execSync(
        "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader",
        { timeout: 3000, encoding: "utf-8" }
      ).trim();
      const [gpuName, memStr] = raw.split(",").map((s) => s.trim());
      const match = memStr?.match(/(\d+)\s*MiB/);
      if (match) {
        return {
          gpuName,
          vramGb: Math.round(Number(match[1]) / 1024),
          accelerator: "CUDA",
          detectionMethod: "nvidia-smi",
        };
      }
    } catch { /* no NVIDIA */ }

    // 2. macOS — Apple Silicon / AMD via system_profiler
    if (process.platform === "darwin") {
      try {
        const raw = execSync(
          "system_profiler SPDisplaysDataType -json",
          { timeout: 5000, encoding: "utf-8" }
        );
        const data = JSON.parse(raw);
        const gpu = data?.SPDisplaysDataType?.[0];
        const vramStr: string = gpu?.spdisplays_vram ?? "";
        const match = vramStr.match(/(\d+)\s*(GB|MB)/i);
        if (match) {
          const vramGb = match[2].toUpperCase() === "GB"
            ? Number(match[1])
            : Math.round(Number(match[1]) / 1024);
          return {
            gpuName: gpu?.sppci_model ?? gpu?.spdisplays_vendor ?? "GPU",
            vramGb,
            accelerator: "Metal",
            detectionMethod: "system_profiler",
          };
        }
      } catch { /* not available */ }
    }

    // 3. Linux — parse /proc or lspci as last resort
    if (process.platform === "linux") {
      try {
        const raw = execSync("lspci | grep -i vga", { timeout: 2000, encoding: "utf-8" }).trim();
        if (raw) {
          return { gpuName: raw.split(":").slice(-1)[0].trim(), vramGb: null, accelerator: null, detectionMethod: "lspci" };
        }
      } catch { /* no lspci */ }
    }

    return { gpuName: null, vramGb: null, accelerator: null, detectionMethod: "none" };
  }

  recommend(info: SystemInfo, installedModelIds: string[]): ModelRecommendation {
    // On CPU-only machines, cap the budget — big models technically fit in RAM
    // but are far too slow without GPU acceleration.
    const cpuOnly = info.vramGb == null && !info.unifiedMemory;
    const budget = cpuOnly ? Math.min(info.usableGb, 5) : info.usableGb;

    // Everything that runs on this machine, largest first.
    const fitting = CATALOG.filter((m) => m.memGb <= budget).sort((a, b) => b.memGb - a.memGb);
    const pool = fitting.length ? fitting : [[...CATALOG].sort((a, b) => a.memGb - b.memGb)[0]];

    // Primary = the largest general-purpose model that fits COMFORTABLY (within
    // ~90% of budget, so it isn't maxing out memory). Alternatives may go right
    // up to the full budget.
    const comfy = pool.filter((m) => m.memGb <= budget * 0.9);
    const chosen = comfy.find((m) => m.tag === "general") ?? comfy[0] ?? pool.find((m) => m.tag === "general") ?? pool[0];

    // Diverse alternatives: prefer different families AND use-cases (reasoning,
    // code, vision, other general families), and guarantee a small/fast pick —
    // so the list reflects the breadth of the library, not one repeated family.
    const fam = (id: string) => id.split(":")[0];
    const rest = pool.filter((m) => m.modelId !== chosen.modelId);
    const alts: CatalogModel[] = [];
    const seenFam = new Set([fam(chosen.modelId)]);
    const seenTag = new Set<ModelTag>([chosen.tag]);
    for (const m of rest) {
      if (alts.length >= 4) break;
      if (!seenFam.has(fam(m.modelId)) || !seenTag.has(m.tag)) {
        alts.push(m); seenFam.add(fam(m.modelId)); seenTag.add(m.tag);
      }
    }
    if (!alts.some((m) => m.memGb <= 4)) {
      const fast = rest.filter((m) => m.memGb <= 4 && !alts.includes(m)).sort((a, b) => b.memGb - a.memGb)[0];
      if (fast) { if (alts.length >= 4) alts.pop(); alts.push(fast); }
    }
    for (const m of rest) { if (alts.length >= 4) break; if (!alts.includes(m)) alts.push(m); }

    // Transparent, computed reason derived from THIS machine's numbers.
    const memType = info.vramGb != null ? `${info.vramGb} GB VRAM`
      : info.unifiedMemory ? `${info.ramGb} GB unified memory`
      : `${info.ramGb} GB RAM (CPU)`;
    const headroom = budget - chosen.memGb;
    const fit = headroom >= 6 ? "with comfortable headroom"
      : headroom >= 2 ? "a solid fit"
      : headroom >= 0 ? "the largest that fits"
      : "the lightest available — your hardware is below its needs";
    let reason = `${memType} → ~${budget} GB usable for models. ${chosen.label} needs ~${chosen.memGb} GB — ${fit}.`;
    if (info.freeGb < chosen.memGb) {
      reason += ` Only ~${info.freeGb} GB free right now — it'll still run (the OS frees cache on demand), but close heavy apps for best speed.`;
    }

    return {
      modelId: chosen.modelId,
      label: chosen.label,
      reason,
      size: chosen.size,
      vramRequired: chosen.memGb,
      alternatives: alts.slice(0, 4).map((m) => ({ modelId: m.modelId, label: m.label, note: m.blurb, size: m.size })),
      alreadyInstalled: installedModelIds.includes(chosen.modelId),
    };
  }
}
