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

/** Model tiers — ordered best-to-smallest within each VRAM bracket. */
const TIERS = [
  { minVram: 24, modelId: "qwen2.5:32b",   label: "Qwen 2.5 32B",   reason: "Excellent reasoning — your GPU has the headroom for it" },
  { minVram: 16, modelId: "qwen2.5:14b",   label: "Qwen 2.5 14B",   reason: "Top-tier quality for a 16 GB card" },
  { minVram: 8,  modelId: "llama3.1:8b",   label: "Llama 3.1 8B",   reason: "Great balance of speed and quality for an 8 GB GPU" },
  { minVram: 4,  modelId: "llama3.2:3b",   label: "Llama 3.2 3B",   reason: "Fast and capable — best fit for your VRAM" },
];

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
    const base: Omit<SystemInfo, "vramGb" | "gpuName" | "detectionMethod"> = {
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model ?? "Unknown",
      ramGb: Math.round(os.totalmem() / 1e9),
    };

    // Try to detect VRAM in platform-appropriate ways
    const gpu = this.detectGpu();
    return { ...base, ...gpu };
  }

  private detectGpu(): Pick<SystemInfo, "vramGb" | "gpuName" | "detectionMethod"> {
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
            gpuName: gpu?.spdisplays_vendor ?? "Apple GPU",
            vramGb,
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
          return { gpuName: raw.split(":").slice(-1)[0].trim(), vramGb: null, detectionMethod: "lspci" };
        }
      } catch { /* no lspci */ }
    }

    return { gpuName: null, vramGb: null, detectionMethod: "none" };
  }

  recommend(info: SystemInfo, installedModelIds: string[]): ModelRecommendation {
    let chosen: typeof TIERS[0] | typeof CPU_TIERS[0] | null = null;

    if (info.vramGb != null) {
      chosen = [...TIERS].find((t) => info.vramGb! >= t.minVram) ?? CPU_TIERS.find((t) => info.ramGb >= t.minRam)!;
    } else {
      chosen = CPU_TIERS.find((t) => info.ramGb >= t.minRam)!;
    }

    // Alternatives: two tiers above/below
    const allTiers = [...TIERS, ...CPU_TIERS];
    const alternatives = allTiers
      .filter((t) => t.modelId !== chosen!.modelId)
      .slice(0, 3)
      .map((t) => ({ modelId: t.modelId, label: t.label, note: t.reason }));

    return {
      modelId: chosen.modelId,
      label: chosen.label,
      reason: chosen.reason,
      vramRequired: "minVram" in chosen ? chosen.minVram : null,
      alternatives,
      alreadyInstalled: installedModelIds.includes(chosen.modelId),
    };
  }
}
