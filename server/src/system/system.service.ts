import { Injectable } from "@nestjs/common";
import { execSync } from "node:child_process";
import { statfsSync } from "node:fs";
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

export type FitTier = "ideal" | "good" | "marginal" | "possible" | "too-large";

export interface ScoredModel {
  modelId: string;
  label: string;
  size: string;     // download size, e.g. "~9 GB"
  tag: ModelTag;
  note: string;     // blurb
  memGb: number;    // approx runtime memory need
  score: number;    // 0–1 weighted fit score
  tier: FitTier;
}

export interface ModelRecommendation {
  modelId: string;
  label: string;
  reason: string;
  size: string | null;
  tier: FitTier;
  vramRequired: number | null;
  /** Every catalog model scored for THIS machine, best fit first. */
  ranked: ScoredModel[];
  /** Diverse subset (kept for the compact view). */
  alternatives: { modelId: string; label: string; note: string; size: string | null; tier: FitTier }[];
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
   * The "fast" memory budget — how much a model can use while staying on the
   * fast path (GPU VRAM, or unified memory on Apple Silicon). Models bigger than
   * this still RUN by offloading to system RAM (see scoreModel's capacity), just
   * slower. Dedicated GPU → VRAM; Apple → ~60% of unified RAM; CPU → ~50% RAM.
   */
  private usableBudget(info: Omit<SystemInfo, "usableGb">): number {
    if (info.vramGb != null) return info.vramGb;
    return Math.max(2, Math.round(info.ramGb * 0.6));
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

  /** Free disk space (GB) where Ollama stores models (~/.ollama). */
  private diskFreeGb(): number {
    try {
      const s = statfsSync(os.homedir());
      return Math.round((s.bavail * s.bsize) / 1e9);
    } catch {
      return Infinity; // can't tell → don't let disk gate anything
    }
  }

  /**
   * Score a model's fit for this machine, ollama-fit style:
   *   score = VRAM·0.40 + RAM·0.25 + Disk·0.15 + Speed·0.20
   * then bucket into a tier. Memory budget (info.usableGb) reserves room for the
   * OS; speed reflects the accelerator (Metal/CUDA fast, CPU slow).
   */
  private scoreModel(m: CatalogModel, info: SystemInfo, diskFreeGb: number): ScoredModel {
    const cpuOnly = info.vramGb == null && !info.unifiedMemory;
    const fast = info.usableGb; // VRAM (dedicated) or ~60% unified RAM
    // Total memory the model can occupy and still run. A dedicated GPU can
    // OFFLOAD layers it can't hold in VRAM to system RAM, so capacity =
    // VRAM + most of system RAM. Apple unified = a slice of RAM; CPU = RAM.
    const capacity = info.unifiedMemory
      ? Math.round(info.ramGb * 0.85)
      : info.vramGb != null
        ? info.vramGb + Math.round(info.ramGb * 0.7)
        : Math.round(info.ramGb * 0.6);
    const downloadGb = parseFloat(m.size.replace(/[^0-9.]/g, "")) || m.memGb;

    // VRAM/fast fit: 1 if it lives entirely in fast memory, partial if it spills, 0 on CPU.
    let vram: number;
    if (cpuOnly) vram = 0;
    else if (m.memGb <= fast) vram = 1;
    else if (m.memGb <= fast * 1.5) vram = Math.max(0.25, 0.65 - 0.4 * ((m.memGb - fast) / (fast * 0.5)));
    else vram = 0;

    // Capacity fit: does it fit in (fast + offload) memory at all?
    const ram = m.memGb <= capacity ? 1 : Math.max(0, capacity / m.memGb);
    const disk = diskFreeGb >= downloadGb ? 1 : 0;

    // Speed: degrades as more of the model offloads off the fast path to RAM.
    const base = info.accelerator === "CUDA" ? 1
      : info.accelerator === "Metal" ? (info.ramGb >= 36 ? 1 : 0.85)
      : info.vramGb != null ? 0.6
      : 0.15; // CPU
    const onFast = info.unifiedMemory || cpuOnly ? 1 : Math.min(1, fast / m.memGb);
    const speed = info.unifiedMemory || cpuOnly ? base : base * (0.3 + 0.7 * onFast);

    const score = vram * 0.4 + ram * 0.25 + disk * 0.15 + speed * 0.2;

    let tier: FitTier;
    if (disk === 0 || m.memGb > capacity * 1.05) tier = "too-large";
    else if (score >= 0.82) tier = "ideal";
    else if (score >= 0.62) tier = "good";
    else if (score >= 0.38) tier = "marginal";
    else if (score >= 0.15) tier = "possible";
    else tier = "too-large";

    return { modelId: m.modelId, label: m.label, size: m.size, tag: m.tag, note: m.blurb, memGb: m.memGb, score: Math.round(score * 100) / 100, tier };
  }

  recommend(info: SystemInfo, installedModelIds: string[]): ModelRecommendation {
    const diskFreeGb = this.diskFreeGb();
    // Rank by fit tier, then by size (largest first) within a tier — so the most
    // CAPABLE model that still fits well sits at the top, not the tiniest.
    const TIER_RANK: Record<FitTier, number> = { ideal: 0, good: 1, marginal: 2, possible: 3, "too-large": 4 };
    const ranked = CATALOG.map((m) => this.scoreModel(m, info, diskFreeGb))
      .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.memGb - a.memGb);
    const runnable = ranked.filter((m) => m.tier !== "too-large");

    // Headline pick: the LARGEST general model that still fits well (ideal or
    // good) — i.e. the most capable model that runs at a decent speed, allowing
    // light GPU→RAM offload. (Picking the largest ideal-only would under-serve a
    // high-RAM dedicated GPU, whose extra capacity shows up as "good".)
    const bySizeDesc = (a: ScoredModel, b: ScoredModel) => b.memGb - a.memGb;
    const chosen =
      runnable.filter((m) => m.tag === "general" && (m.tier === "ideal" || m.tier === "good")).sort(bySizeDesc)[0] ??
      runnable.filter((m) => m.tag === "general").sort(bySizeDesc)[0] ??
      runnable[0] ?? ranked[0];

    // Diverse alternatives (best-scoring first): different families + use-cases,
    // plus a guaranteed small/fast option.
    const fam = (id: string) => id.split(":")[0];
    const rest = runnable.filter((m) => m.modelId !== chosen.modelId);
    const alts: ScoredModel[] = [];
    const seenFam = new Set([fam(chosen.modelId)]);
    const seenTag = new Set<ModelTag>([chosen.tag]);
    for (const m of rest) {
      if (alts.length >= 5) break;
      if (!seenFam.has(fam(m.modelId)) || !seenTag.has(m.tag)) {
        alts.push(m); seenFam.add(fam(m.modelId)); seenTag.add(m.tag);
      }
    }
    if (!alts.some((m) => m.memGb <= 4)) {
      const fast = rest.filter((m) => m.memGb <= 4 && !alts.includes(m))[0];
      if (fast) { if (alts.length >= 5) alts.pop(); alts.push(fast); }
    }
    for (const m of rest) { if (alts.length >= 5) break; if (!alts.includes(m)) alts.push(m); }

    // Transparent, computed reason derived from THIS machine's numbers.
    const memType = info.vramGb != null ? `${info.vramGb} GB VRAM`
      : info.unifiedMemory ? `${info.ramGb} GB unified memory`
      : `${info.ramGb} GB RAM (CPU)`;
    const tierWord = chosen.tier === "ideal" ? "an ideal fit"
      : chosen.tier === "good" ? "a good fit"
      : chosen.tier === "marginal" ? "a marginal fit"
      : "the best your hardware can run";
    let reason = `${memType} → ~${info.usableGb} GB usable for models. ${chosen.label} needs ~${chosen.memGb} GB — ${tierWord}.`;
    // Surface the ceiling: bigger models the machine can run via GPU→RAM offload.
    const ceiling = runnable.reduce((a, b) => (b.memGb > a.memGb ? b : a), chosen);
    if (!info.unifiedMemory && info.vramGb != null && ceiling.memGb > chosen.memGb) {
      reason += ` Your ${info.ramGb} GB RAM lets you offload to run up to ${ceiling.label} (~${ceiling.memGb} GB, slower).`;
    }
    if (info.freeGb < chosen.memGb) {
      reason += ` Only ~${info.freeGb} GB free right now — it'll still run (the OS frees cache on demand), but close heavy apps for best speed.`;
    }

    return {
      modelId: chosen.modelId,
      label: chosen.label,
      reason,
      size: chosen.size,
      tier: chosen.tier,
      vramRequired: chosen.memGb,
      ranked,
      alternatives: alts.slice(0, 5).map((m) => ({ modelId: m.modelId, label: m.label, note: m.note, size: m.size, tier: m.tier })),
      alreadyInstalled: installedModelIds.includes(chosen.modelId),
    };
  }
}
