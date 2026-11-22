import { readToken } from '@codecolony/dock/web'
import { useEffect, useState } from 'react'
import type { FileResponse } from '../../modules/wire/api-types.ts'

export type FileTextState =
  | { status: 'loading' }
  | { status: 'ready'; file: FileResponse }
  | { status: 'error'; message: string }

// A file's text at its repository's indexed commit, fetched again when the
// file or the commit changes. Source text needs the token the server printed.
export function useFileText(fileId: string, commit: string | undefined): FileTextState {
  const [state, setState] = useState<FileTextState>({ status: 'loading' })
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new commit means new text, so fetch again.
  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    fetchFileText(fileId, controller.signal).then(
      (file) => {
        if (!controller.signal.aborted) setState({ status: 'ready', file })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: messageOf(error) })
      },
    )
    return () => controller.abort()
  }, [fileId, commit])
  return state
}

async function fetchFileText(fileId: string, signal: AbortSignal): Promise<FileResponse> {
  const token = readToken()
  if (!token) throw new Error('No token: open the URL the server printed, with #token=...')
  const response = await fetch(`/api/file?id=${encodeURIComponent(fileId)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal,
  })
  if (response.status === 401) {
    throw new Error('Token not accepted: the server restarted, open the URL it printed')
  }
  const body = (await response.json()) as FileResponse | { error: string }
  if ('error' in body) throw new Error(body.error)
  return body
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
