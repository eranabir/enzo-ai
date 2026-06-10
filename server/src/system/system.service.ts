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

/** Approx download size (Q4) per model, shown wherever a model is listed. */
const MODEL_SIZES: Record<string, string> = {
  "qwen2.5:32b": "~20 GB",
  "qwen2.5:14b": "~9 GB",
  "qwen2.5:7b": "~4.7 GB",
  "qwen2.5:0.5b": "~0.4 GB",
  "llama3.1:8b": "~4.9 GB",
  "llama3.2:3b": "~2 GB",
  "llama3.2:1b": "~1.3 GB",
};
export function modelSize(id: string): string | null {
  return MODEL_SIZES[id] ?? null;
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

/** A model the recommender can pick, with its approx RUNTIME memory need (Q4
 *  weights + a working context) in GB. Ladders are ordered largest → smallest;
 *  we pick the largest whose memGb fits the machine's usable budget. */
interface ModelRung { modelId: string; label: string; memGb: number; blurb: string }

// GPU-class ladders (Apple Metal or dedicated VRAM) — can run bigger models.
const GPU_LADDER: ModelRung[] = [
  { modelId: "qwen2.5:32b", label: "Qwen 2.5 32B", memGb: 22, blurb: "Top-tier reasoning — heavy on memory" },
  { modelId: "qwen2.5:14b", label: "Qwen 2.5 14B", memGb: 11, blurb: "Great quality-to-speed balance" },
  { modelId: "llama3.1:8b", label: "Llama 3.1 8B", memGb: 6,  blurb: "Solid all-rounder" },
  { modelId: "llama3.2:3b", label: "Llama 3.2 3B", memGb: 4,  blurb: "Fast and light" },
  { modelId: "llama3.2:1b", label: "Llama 3.2 1B", memGb: 2,  blurb: "Tiny and quick" },
];
// CPU-only — keep it small; CPU inference of big models is too slow.
const CPU_LADDER: ModelRung[] = [
  { modelId: "llama3.2:3b",  label: "Llama 3.2 3B",  memGb: 4,   blurb: "Largest that stays usable on CPU" },
  { modelId: "llama3.2:1b",  label: "Llama 3.2 1B",  memGb: 2,   blurb: "Lightweight CPU model" },
  { modelId: "qwen2.5:0.5b", label: "Qwen 2.5 0.5B", memGb: 1.5, blurb: "Ultra-light for constrained systems" },
];

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
    const frac = info.unifiedMemory ? 0.6 : 0.5;
    return Math.max(2, Math.round(info.ramGb * frac));
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
    // GPU-class (Apple Metal or dedicated VRAM) can run bigger models than CPU.
    const ladder = info.vramGb != null || info.unifiedMemory ? GPU_LADDER : CPU_LADDER;
    const budget = info.usableGb;

    // Pick the largest model whose runtime memory fits the budget; if even the
    // smallest doesn't, recommend it anyway (best effort).
    const chosen = ladder.find((m) => m.memGb <= budget) ?? ladder[ladder.length - 1];

    // Transparent, computed reason derived from THIS machine's numbers.
    const memType = info.vramGb != null
      ? `${info.vramGb} GB VRAM`
      : info.unifiedMemory
        ? `${info.ramGb} GB unified memory`
        : `${info.ramGb} GB RAM (CPU)`;
    const headroom = budget - chosen.memGb;
    const fit = headroom >= 6 ? "with comfortable headroom"
      : headroom >= 2 ? "a solid fit"
      : headroom >= 0 ? "the largest that fits"
      : "the lightest available — your hardware is below its needs";
    let reason = `${memType} → ~${budget} GB usable for models. ${chosen.label} needs ~${chosen.memGb} GB — ${fit}.`;
    // Live-pressure hint: macOS under-reports free memory, so only warn when it's
    // genuinely lower than what the model needs.
    if (info.freeGb < chosen.memGb) {
      reason += ` Only ~${info.freeGb} GB free right now — it'll still run (the OS frees cache on demand), but close heavy apps for best speed.`;
    }

    const alternatives = ladder
      .filter((m) => m.modelId !== chosen.modelId)
      .slice(0, 3)
      .map((m) => ({ modelId: m.modelId, label: m.label, note: m.blurb, size: MODEL_SIZES[m.modelId] ?? null }));

    return {
      modelId: chosen.modelId,
      label: chosen.label,
      reason,
      size: MODEL_SIZES[chosen.modelId] ?? null,
      vramRequired: chosen.memGb,
      alternatives,
      alreadyInstalled: installedModelIds.includes(chosen.modelId),
    };
  }
}
