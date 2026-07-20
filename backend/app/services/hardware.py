"""Hardware detection → recommended extraction defaults + the GPU inference
backend available on this platform (DirectML on Windows, CoreML on macOS)."""

import platform

import psutil


def detect() -> dict:
    try:
        import onnxruntime as ort

        providers = ort.get_available_providers()
    except Exception:
        providers = []

    ram_gb = round(psutil.virtual_memory().total / 1024**3, 1)
    cores = psutil.cpu_count(logical=False) or psutil.cpu_count() or 1

    os_name = platform.system().lower()  # 'windows' | 'darwin' | 'linux'
    arch = platform.machine().lower()  # 'amd64' | 'arm64' | 'x86_64' ...
    apple_silicon = os_name == "darwin" and arch in ("arm64", "aarch64")

    has_dml = "DmlExecutionProvider" in providers
    has_cuda = "CUDAExecutionProvider" in providers
    has_coreml = "CoreMLExecutionProvider" in providers

    # The single GPU backend this platform can toggle to (what the UI offers
    # alongside CPU). CoreML on Intel Macs works but is weak, so it's exposed
    # yet not the recommended default there.
    gpu_provider = (
        "directml" if has_dml else "coreml" if has_coreml else "cuda" if has_cuda else None
    )
    strong_gpu = has_dml or has_cuda or apple_silicon
    has_gpu = has_dml or has_cuda or has_coreml
    low_ram = ram_gb < 16

    if strong_gpu:
        tier = "gpu"
        recommended_max_size = 960
    elif not low_ram:
        tier = "cpu"
        recommended_max_size = 768
    else:
        tier = "low"
        recommended_max_size = 512

    recommended_provider = (
        gpu_provider if strong_gpu and gpu_provider in ("directml", "coreml") else "cpu"
    )

    return {
        "platform": platform.platform(),
        "os": os_name,
        "arch": arch,
        "cpu": platform.processor(),
        "cpu_cores": cores,
        "ram_gb": ram_gb,
        "available_providers": providers,
        # The GPU backend the UI can switch to (None → CPU only).
        "gpu_provider": gpu_provider,
        "active_provider": recommended_provider,
        # Tier drives the first-run hint; reasons let the UI explain the choice.
        "tier": tier,
        "has_gpu": has_gpu,
        "low_ram": low_ram,
        "recommended": {
            "ort_provider": recommended_provider,
            "default_max_size": recommended_max_size,
            "default_stride_mode": "auto",
        },
    }
