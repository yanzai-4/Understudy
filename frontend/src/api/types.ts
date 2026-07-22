export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export type ShotStatus = 'draft' | 'extracted' | 'exported'

export interface Film {
  id: string
  name: string
  description: string
  notes: string
  status: 'active' | 'archived'
  cover_url: string | null
  default_camera_params: Record<string, string> | null
  shot_count: number
  scene_count: number
  exported_count: number
  created_at: string
  updated_at: string
}

export interface Shot {
  id: string
  film_id: string
  name: string
  scene_no: number | null
  version: number
  tags: string[]
  is_picked: boolean
  notes: string
  status: ShotStatus
  thumbnail_url: string | null
  source_filename: string | null
  video_width: number | null
  video_height: number | null
  video_fps: number | null
  video_frame_count: number | null
  video_duration_sec: number | null
  extract_stride: number | null
  extract_max_size: number | null
  extract_frame_count: number | null
  extracted_channels: string[] | null
  created_at: string
  updated_at: string
}

export interface SceneGroup {
  scene_no: number | null
  shots: Shot[]
}

export interface ShotGroups {
  groups: SceneGroup[]
  total: number
}

export interface ShotFilters {
  search?: string
  scene_no?: number | null
  status?: ShotStatus | ''
  version?: number | null
  picked?: boolean
  tags?: string[]
}

export interface TaskSnapshot {
  id: string
  kind: 'extract' | 'export' | 'model_download'
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number
  stage: string
  error: string | null
  result: Record<string, unknown> | null
}

export interface ExtractorInfo {
  name: string
  requires_models: string[]
}

export interface ExtractionMeta {
  schema_version: number
  stride: number
  max_size: number
  output_size: [number, number]
  effective_fps: number
  frame_count: number
  channels: string[]
  summaries: Record<string, Record<string, unknown>>
  source: { width: number; height: number; fps: number; frame_count: number }
}

export interface MappingOption {
  key: string
  label_zh: string
  label_en: string
  fragment: string
}

export interface MappingDimension {
  key: string
  label_zh: string
  label_en: string
  order: number
  options: MappingOption[]
}

export interface PromptMappings {
  schema_version: number
  negative_default: string
  focal_lengths: MappingOption[]
  dimensions: MappingDimension[]
}

// ---------- lens control ----------

/** A timeline segment holds one steady value over [start, end]; gaps between
 * segments ease from one value to the next, touching edges = a single switch. */
export interface FocusSegment {
  start: number
  end: number
  depth: number // 0..1, 1 = near (white in the depth map)
  label: string
}

export interface ZoomSegment {
  start: number
  end: number
  focal: string // focal_lengths option key, e.g. '35mm'
  cx: number
  cy: number
}

export const SEGMENT_CAP = 3 // max segments per lane (mirror backend lens.py)

export interface LensData {
  focus: {
    enabled: boolean
    max_blur: number
    falloff: number
    easing: 'linear' | 'smooth'
    follow_subject: boolean // exclusive: when on, segments are ignored
    segments: FocusSegment[]
  }
  zoom: {
    enabled: boolean
    segments: ZoomSegment[]
  }
  focal: string | null
}

export interface CameraParamsValues {
  shot_size: string | null
  camera_angle: string | null
  focal_length: string | null
  aperture: string | null
  shutter: string | null
  camera_move: string | null
  light_position: string | null
  light_quality: string | null
  light_mood: string | null
  time_ambience: string | null
  weather: string | null
  color_grade: string | null
  style_suffix: string | null
  subject_desc: string
  scene_desc: string
  custom_positive: string
  custom_negative: string
}

export type OrtProvider = 'cpu' | 'directml' | 'coreml'

export interface HardwareProfile {
  platform: string
  os: 'windows' | 'darwin' | 'linux' | string
  arch: string
  cpu: string
  cpu_cores: number
  ram_gb: number
  available_providers: string[]
  /** GPU backend this platform can toggle to, or null for CPU-only. */
  gpu_provider: 'directml' | 'coreml' | 'cuda' | null
  active_provider: OrtProvider
  tier: 'gpu' | 'cpu' | 'low'
  has_gpu: boolean
  low_ram: boolean
  recommended: {
    ort_provider: OrtProvider
    default_max_size: number
    default_stride_mode: string
    layout_model: 'fast' | 'quality'
  }
}

export interface ModelInfo {
  key: string
  name: string
  size_mb: number
  status: 'ready' | 'missing'
  required: boolean
}

export interface AppSettings {
  first_run_completed: boolean
  language: 'zh' | 'en'
  ort_provider: OrtProvider
  default_max_size: number
  default_stride_mode: string
  depth_model_variant: 'int8' | 'fp32'
  layout_model: 'fast' | 'quality'
  hardware_profile: Record<string, unknown> | null
  requires_reinstall?: boolean
}
