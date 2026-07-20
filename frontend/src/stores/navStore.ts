import { create } from 'zustand'

/**
 * Breadcrumb state published by the film/shot pages so the sidebar can render
 * an animated sub-tree under 作品. Names persist after navigating away so the
 * collapse animation still has content while it slides shut — visibility is
 * driven by the current route, not by this store.
 */
export interface NavCrumb {
  id: string
  name: string
}

export interface NavShotCrumb extends NavCrumb {
  scene_no: number | null
}

interface NavState {
  film: NavCrumb | null
  shot: NavShotCrumb | null
  setNav: (film: NavCrumb | null, shot?: NavShotCrumb | null) => void
}

export const useNavStore = create<NavState>((set) => ({
  film: null,
  shot: null,
  setNav: (film, shot = null) => set({ film, shot }),
}))
