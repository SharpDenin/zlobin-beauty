/** Create: omit empty so the service is stored without a photo. */
export function photoMediaIdForCreate(id: string | null | undefined): string | undefined {
  return id?.trim() || undefined
}

/** PATCH: empty string / JSON null clears photo_media_id (see backend applyPhotoMediaField). */
export function photoMediaIdForPatch(id: string | null | undefined): string {
  return id?.trim() ?? ''
}
