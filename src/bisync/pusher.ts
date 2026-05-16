/**
 * Push primitives.
 *
 * Both update and create return the *server-canonicalized* body and its
 * hash — never the body we sent. Outline normalizes markdown on the
 * server, so storing the sent body's hash would falsely flag the doc as
 * "local-changed" on the very next reconcile pass.
 */

import type { Document, IOutlineApi } from '../outline-api/types';
import { sha256 } from './hash';

export interface PushResult {
  outlineId: string;
  collectionId: string;
  revision: number;
  syncedHash: string;
  canonicalText: string;
  urlId?: string;
  title: string;
}

export async function pushUpdate(
  api: IOutlineApi,
  params: { id: string; title: string; text: string }
): Promise<PushResult | null> {
  const updated = await api.updateDocument({
    id: params.id,
    title: params.title,
    text: params.text,
    publish: true,
  });
  return fromResponse(updated);
}

export async function pushCreate(
  api: IOutlineApi,
  params: {
    title: string;
    text: string;
    collectionId: string;
    parentDocumentId?: string;
  }
): Promise<PushResult | null> {
  const created = await api.createDocument({
    title: params.title,
    text: params.text,
    collectionId: params.collectionId,
    parentDocumentId: params.parentDocumentId,
    publish: true,
  });
  return fromResponse(created);
}

async function fromResponse(doc: Document | null): Promise<PushResult | null> {
  if (!doc || !doc.id) return null;
  const canonicalText = doc.text ?? '';
  return {
    outlineId: doc.id,
    collectionId: doc.collectionId ?? '',
    revision: doc.revision ?? 0,
    syncedHash: await sha256(canonicalText),
    canonicalText,
    urlId: doc.urlId,
    title: doc.title ?? '',
  };
}
