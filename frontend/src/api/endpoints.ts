import { api, qs } from './client'
import type {
  AppSettings,
  BackgroundEdit,
  CameraParamsValues,
  EditType,
  LensData,
  PromptMappings,
  ExtractionMeta,
  ExtractorInfo,
  Film,
  HardwareProfile,
  ModelInfo,
  OrtProvider,
  Page,
  Shot,
  ShotFilters,
  ShotGroups,
  TaskSnapshot,
} from './types'

// ---------- Films ----------

export const listFilms = (params: { search?: string; sort?: string; page?: number; page_size?: number }) =>
  api.get<Page<Film>>(`/api/films${qs(params)}`)

export const createFilm = (body: { name: string; description?: string }) =>
  api.post<Film>('/api/films', body)

export const getFilm = (id: string) => api.get<Film>(`/api/films/${id}`)

export const updateFilm = (id: string, body: Partial<Pick<Film, 'name' | 'description' | 'notes' | 'status' | 'default_camera_params'>>) =>
  api.patch<Film>(`/api/films/${id}`, body)

export const deleteFilm = (id: string) => api.delete(`/api/films/${id}`)

export const getFilmTags = (id: string) => api.get<string[]>(`/api/films/${id}/tags`)

// ---------- Whiteboard ----------

export interface BoardData {
  nodes: Record<string, { x: number; y: number; parent?: string }>
  scenes: Record<string, { x: number; y: number; w: number; h: number }>
  edges: {
    id: string
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }[]
}

export const getBoard = (filmId: string) => api.get<BoardData>(`/api/films/${filmId}/board`)

export const putBoard = (filmId: string, data: BoardData) =>
  api.put<BoardData>(`/api/films/${filmId}/board`, { data })

// ---------- Shots ----------

function shotFilterParams(filters: ShotFilters) {
  return {
    search: filters.search,
    scene_no: filters.scene_no ?? undefined,
    status: filters.status || undefined,
    version: filters.version ?? undefined,
    picked: filters.picked ? true : undefined,
    tags: filters.tags,
  }
}

export const listShots = (
  filmId: string,
  filters: ShotFilters,
  params: { sort?: string; page?: number; page_size?: number },
) => api.get<Page<Shot>>(`/api/films/${filmId}/shots${qs({ ...shotFilterParams(filters), ...params })}`)

export const listShotsGrouped = (filmId: string, filters: ShotFilters) =>
  api.get<ShotGroups>(`/api/films/${filmId}/shots/grouped${qs(shotFilterParams(filters))}`)

export const createShot = (
  filmId: string,
  body: { name: string; scene_no?: number | null; tags?: string[]; notes?: string },
) => api.post<Shot>(`/api/films/${filmId}/shots`, body)

export const getShot = (id: string) => api.get<Shot>(`/api/shots/${id}`)

export const updateShot = (
  id: string,
  body: Partial<{
    name: string
    scene_no: number | null
    clear_scene_no: boolean
    version: number
    tags: string[]
    notes: string
    is_picked: boolean
  }>,
) => api.patch<Shot>(`/api/shots/${id}`, body)

export const deleteShot = (id: string) => api.delete(`/api/shots/${id}`)

export const duplicateShot = (id: string, asNewVersion = true) =>
  api.post<Shot>(`/api/shots/${id}/duplicate`, { as_new_version: asNewVersion })

// ---------- Extraction & tasks ----------

export const listExtractors = () => api.get<ExtractorInfo[]>('/api/system/extractors')

export const startExtraction = (
  shotId: string,
  body: { channels: string[]; stride: number | 'auto'; max_size: number },
) => api.post<{ task_id: string }>(`/api/shots/${shotId}/extract`, body)

export const getExtraction = (shotId: string) =>
  api.get<ExtractionMeta>(`/api/shots/${shotId}/extraction`)

export const getTask = (taskId: string) => api.get<TaskSnapshot>(`/api/tasks/${taskId}`)

export const cancelTask = (taskId: string) => api.post<{ ok: boolean }>(`/api/tasks/${taskId}/cancel`)

// ---------- Background edits ----------

export const listBackgroundEdits = (shotId: string) =>
  api.get<BackgroundEdit[]>(`/api/shots/${shotId}/background-edits`)

export const createBackgroundEdit = (
  shotId: string,
  body: {
    label: string
    edit_type: EditType
    description: string
    x: number
    y: number
    w: number
    h: number
  },
) => api.post<BackgroundEdit>(`/api/shots/${shotId}/background-edits`, body)

export const updateBackgroundEdit = (
  editId: number,
  body: Partial<{
    label: string
    edit_type: EditType
    description: string
    x: number
    y: number
    w: number
    h: number
  }>,
) => api.patch<BackgroundEdit>(`/api/background-edits/${editId}`, body)

export const deleteBackgroundEdit = (editId: number) =>
  api.delete(`/api/background-edits/${editId}`)

// ---------- Camera params & prompt ----------

export const getPromptMappings = () => api.get<PromptMappings>('/api/prompt-mappings')

export const getCameraParams = (shotId: string) =>
  api.get<CameraParamsValues>(`/api/shots/${shotId}/camera-params`)

export const putCameraParams = (shotId: string, values: CameraParamsValues) =>
  api.put<CameraParamsValues>(`/api/shots/${shotId}/camera-params`, values)

export const generatePrompt = (shotId: string) =>
  api.post<{ id: number; positive: string; negative: string }>(`/api/shots/${shotId}/prompt`)

// ---------- Lens control ----------

export const getLens = (shotId: string) => api.get<LensData>(`/api/shots/${shotId}/lens`)

export const putLens = (shotId: string, data: LensData) =>
  api.put<LensData>(`/api/shots/${shotId}/lens`, { data })

/** Single-frame preview with (possibly unsaved) lens data; returns a blob URL. */
export async function lensPreview(shotId: string, frame: number, data: LensData): Promise<string> {
  const res = await fetch(`/api/shots/${shotId}/lens/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frame, data }),
  })
  if (!res.ok) throw new Error(`preview failed: ${res.status}`)
  return URL.createObjectURL(await res.blob())
}

export const startLensRender = (shotId: string) =>
  api.post<{ task_id: string }>(`/api/shots/${shotId}/lens/render`)

// ---------- Layout channel ----------

export interface Ade20kAsset {
  classes: string[]
  palette: number[][] // official ADE20K RGB per class (ControlNet-Seg standard)
  groups: string[] // per-class blockout group
  group_order: string[]
  blockout_palette: Record<string, number[]>
  person_index: number
}

export interface LayoutStateData {
  disabled_groups: string[]
  disabled_instances: number[]
  disabled_backdrop: string[] // 'top' | 'bottom' — disabled planes render black
}

let adeAssetCache: Promise<Ade20kAsset> | null = null
export const getAde20k = () => (adeAssetCache ??= api.get<Ade20kAsset>('/api/layout/ade20k'))

export const getLayoutState = (shotId: string) =>
  api.get<LayoutStateData>(`/api/shots/${shotId}/layout`)

export const putLayoutState = (shotId: string, data: LayoutStateData) =>
  api.put<LayoutStateData>(`/api/shots/${shotId}/layout`, { data })

// ---------- Exports ----------

export interface ExportRecordOut {
  id: number
  shot_id: string
  zip_name: string
  size_bytes: number
  created_at: string
  download_url: string
}

export const startExport = (
  shotId: string,
  include: {
    source: boolean
    channels: string[] | null
    masks: boolean
    control_videos: boolean
  },
) => api.post<{ task_id: string }>(`/api/shots/${shotId}/export`, { include })

export const listExports = (shotId: string) =>
  api.get<ExportRecordOut[]>(`/api/shots/${shotId}/exports`)

// ---------- Settings & system ----------

export const getSettings = () => api.get<AppSettings>('/api/settings')

export const updateSettings = (values: Partial<AppSettings>) =>
  api.put<AppSettings>('/api/settings', { values })

export const getHardware = (refresh = false) =>
  api.get<HardwareProfile>(`/api/system/hardware${refresh ? '?refresh=true' : ''}`)

export const listModels = () => api.get<ModelInfo[]>('/api/system/models')

export const switchProvider = (provider: OrtProvider) =>
  api.post<{ restarting: boolean; manual?: boolean; provider: string }>(
    '/api/system/switch-provider',
    { provider },
  )

export const resetAll = (confirm: string, lang: string) =>
  api.post<{ ok: boolean; error?: string; demo_shots?: number }>('/api/system/reset', { confirm, lang })
