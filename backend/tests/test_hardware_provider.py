"""Cross-platform inference-backend selection: the depth extractor's EP mapping
and hardware detection for Windows (DirectML) / macOS Apple Silicon (CoreML)."""
from app.extractors.depth import _providers_for
from app.services import hardware


# ---------- EP mapping (depth.py) ----------


def test_cpu_always_cpu_only():
    assert _providers_for("cpu", ["CoreMLExecutionProvider", "CPUExecutionProvider"]) == [
        "CPUExecutionProvider"
    ]


def test_directml_used_when_available_else_cpu():
    avail = ["DmlExecutionProvider", "CPUExecutionProvider"]
    assert _providers_for("directml", avail) == ["DmlExecutionProvider", "CPUExecutionProvider"]
    assert _providers_for("directml", ["CPUExecutionProvider"]) == ["CPUExecutionProvider"]


def test_coreml_used_when_available_else_cpu():
    avail = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    assert _providers_for("coreml", avail) == ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    assert _providers_for("coreml", ["CPUExecutionProvider"]) == ["CPUExecutionProvider"]


def test_unknown_provider_falls_back_to_cpu():
    assert _providers_for("cuda", ["CUDAExecutionProvider", "CPUExecutionProvider"]) == [
        "CPUExecutionProvider"
    ]  # cuda isn't in the user-switchable map → CPU


# ---------- hardware.detect (mocked platforms) ----------


def _fake_ort(monkeypatch, providers):
    import onnxruntime as ort

    monkeypatch.setattr(ort, "get_available_providers", lambda: providers)


def test_detect_apple_silicon_recommends_coreml(monkeypatch):
    monkeypatch.setattr(hardware.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(hardware.platform, "machine", lambda: "arm64")
    _fake_ort(monkeypatch, ["CoreMLExecutionProvider", "CPUExecutionProvider"])

    p = hardware.detect()
    assert p["os"] == "darwin"
    assert p["arch"] == "arm64"
    assert p["gpu_provider"] == "coreml"
    assert p["tier"] == "gpu"
    assert p["recommended"]["ort_provider"] == "coreml"


def test_detect_windows_cpu_only_recommends_cpu(monkeypatch):
    monkeypatch.setattr(hardware.platform, "system", lambda: "Windows")
    monkeypatch.setattr(hardware.platform, "machine", lambda: "AMD64")
    _fake_ort(monkeypatch, ["CPUExecutionProvider"])

    p = hardware.detect()
    assert p["os"] == "windows"
    assert p["gpu_provider"] is None
    assert p["recommended"]["ort_provider"] == "cpu"


def test_detect_windows_directml_recommends_directml(monkeypatch):
    monkeypatch.setattr(hardware.platform, "system", lambda: "Windows")
    monkeypatch.setattr(hardware.platform, "machine", lambda: "AMD64")
    _fake_ort(monkeypatch, ["DmlExecutionProvider", "CPUExecutionProvider"])

    p = hardware.detect()
    assert p["gpu_provider"] == "directml"
    assert p["tier"] == "gpu"
    assert p["recommended"]["ort_provider"] == "directml"


def test_detect_intel_mac_exposes_coreml_but_defaults_cpu(monkeypatch):
    monkeypatch.setattr(hardware.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(hardware.platform, "machine", lambda: "x86_64")
    _fake_ort(monkeypatch, ["CoreMLExecutionProvider", "CPUExecutionProvider"])

    p = hardware.detect()
    assert p["gpu_provider"] == "coreml"  # toggle still offered
    assert p["recommended"]["ort_provider"] == "cpu"  # not the default on Intel
