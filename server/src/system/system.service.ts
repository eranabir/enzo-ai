import { Injectable } from "@nestjs/common";
import { execSync } from "node:child_process";
import * as os from "node:os";

export interface SystemInfo {
  os: string;
  arch: string;
  cpuCount: number;
  cpuModel: string;
  ramGb: number;
  vramGb: number | null;
  gpuName: string | null;
  /** True on Apple Silicon: GPU shares system RAM (no separate VRAM). */
  unifiedMemory: boolean;
  /** GPU acceleration backend the model engine will use, if any. */
  accelerator: string | null;
  detectionMethod: string;
}

export interface ModelRecommendation {
  modelId: string;
  label: string;
  reason: string;
  vramRequired: number | null;
  alternatives: { modelId: string; label: string; note: string }[];
  alreadyInstalled: boolean;
}

/** Dedicated-GPU tiers (NVIDIA/AMD) — ordered best-to-smallest by VRAM. */
const TIERS = [
  { minVram: 24, modelId: "qwen2.5:32b",   label: "Qwen 2.5 32B",   reason: "Excellent reasoning — your GPU has the headroom for it" },
  { minVram: 16, modelId: "qwen2.5:14b",   label: "Qwen 2.5 14B",   reason: "Top-tier quality for a 16 GB card" },
  { minVram: 8,  modelId: "llama3.1:8b",   label: "Llama 3.1 8B",   reason: "Great balance of speed and quality for an 8 GB GPU" },
  { minVram: 4,  modelId: "llama3.2:3b",   label: "Llama 3.2 3B",   reason: "Fast and capable — best fit for your VRAM" },
];

/** Apple-Silicon tiers — keyed on UNIFIED memory (shared with the OS), so the
 *  thresholds leave headroom for macOS. Metal-accelerated, so these punch above
 *  a CPU-only machine of the same RAM. */
const APPLE_TIERS = [
  { minRam: 48, modelId: "qwen2.5:32b",  label: "Qwen 2.5 32B",  reason: "Your Apple Silicon GPU + unified memory can drive a 32B model" },
  { minRam: 24, modelId: "qwen2.5:14b",  label: "Qwen 2.5 14B",  reason: "Strong reasoning, runs fast on Metal with room to spare" },
  { minRam: 16, modelId: "llama3.1:8b",  label: "Llama 3.1 8B",  reason: "Ideal for 16 GB Apple Silicon — quality without crowding macOS" },
  { minRam: 8,  modelId: "llama3.2:3b",  label: "Llama 3.2 3B",  reason: "Fast and capable on your Mac's GPU" },
  { minRam: 0,  modelId: "llama3.2:1b",  label: "Llama 3.2 1B",  reason: "Lightweight model for a memory-constrained Mac" },
];

/** CPU-only tiers (no GPU acceleration). */
const CPU_TIERS = [
  { minRam: 32, modelId: "llama3.2:3b",   label: "Llama 3.2 3B",   reason: "Runs on CPU — your 32 GB RAM handles it well" },
  { minRam: 16, modelId: "llama3.2:1b",   label: "Llama 3.2 1B",   reason: "Lightweight CPU model for 16 GB RAM" },
  { minRam: 0,  modelId: "qwen2.5:0.5b",  label: "Qwen 2.5 0.5B",  reason: "Ultra-light — best fit for constrained systems" },
];

@Injectable()
export class SystemService {
  /** Detect system hardware. Never throws — returns partial info on errors. */
  async getSystemInfo(): Promise<SystemInfo> {
    const cpus = os.cpus();
    const base: Omit<SystemInfo, "vramGb" | "gpuName" | "unifiedMemory" | "accelerator" | "detectionMethod"> = {
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model ?? "Unknown",
      ramGb: Math.round(os.totalmem() / 1e9),
    };

    // Apple Silicon: unified memory + Metal GPU (no separate VRAM to detect).
    if (process.platform === "darwin" && os.arch() === "arm64") {
      return {
        ...base,
        gpuName: base.cpuModel, // e.g. "Apple M1 Pro" — the chip is the GPU
        vramGb: null,
        unifiedMemory: true,
        accelerator: "Metal",
        detectionMethod: "apple-silicon",
      };
    }

    // Otherwise try to detect a dedicated GPU's VRAM.
    const gpu = this.detectGpu();
    return { ...base, unifiedMemory: false, ...gpu };
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
    // Pick the tier set that matches how this machine runs models:
    //   Apple Silicon → unified-memory tiers (Metal); dedicated GPU → VRAM tiers;
    //   everything else → CPU tiers keyed on RAM.
    let activeTiers: { modelId: string; label: string; reason: string }[];
    let chosen: { modelId: string; label: string; reason: string };

    if (info.unifiedMemory) {
      activeTiers = APPLE_TIERS;
      chosen = APPLE_TIERS.find((t) => info.ramGb >= t.minRam)!;
    } else if (info.vramGb != null) {
      activeTiers = TIERS;
      chosen = TIERS.find((t) => info.vramGb! >= t.minVram) ?? CPU_TIERS.find((t) => info.ramGb >= t.minRam)!;
    } else {
      activeTiers = CPU_TIERS;
      chosen = CPU_TIERS.find((t) => info.ramGb >= t.minRam)!;
    }

    // Alternatives: the other models in the same tier set (smaller/larger fits).
    const alternatives = activeTiers
      .filter((t) => t.modelId !== chosen.modelId)
      .slice(0, 3)
      .map((t) => ({ modelId: t.modelId, label: t.label, note: t.reason }));

    return {
      modelId: chosen.modelId,
      label: chosen.label,
      reason: chosen.reason,
      vramRequired: "minVram" in chosen ? (chosen as { minVram: number }).minVram : null,
      alternatives,
      alreadyInstalled: installedModelIds.includes(chosen.modelId),
    };
  }
}
