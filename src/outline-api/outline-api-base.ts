import { configure, type Transport } from './custom-instance';
import { RateLimiter } from './rate-limiter';
import {
  authInfo,
  collectionsInfo,
  collectionsList,
  collectionsDocuments,
  documentsInfo,
  documentsList,
  documentsCreate,
  documentsUpdate,
  documentsDelete,
  documentsSearch,
  attachmentsCreate,
} from './generated-client/outlineAPI';
import type {
  Collection,
  Document,
  AttachmentsCreate200Data,
  NavigationNode,
} from './generated-client/outlineAPI';
import type { IOutlineApi } from './types';

export type { Collection, Document, AttachmentsCreate200Data, NavigationNode };

export abstract class OutlineApiBase implements IOutlineApi {
  protected baseUrl: string;
  protected apiKey: string;

  constructor(
    baseUrl: string,
    apiKey: string,
    transport?: Transport,
    rateLimiter?: RateLimiter | null
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    configure({ baseUrl: this.baseUrl, apiKey: this.apiKey, transport, rateLimiter });
  }

  async validateAuth(): Promise<string | null> {
    try {
      const res = await authInfo();
      if (res.status !== 200) return null;
      return res.data.data?.user?.name ?? 'Unknown';
    } catch {
      return null;
    }
  }

  async listCollections(): Promise<Collection[] | null> {
    try {
      const res = await collectionsList({ limit: 100 });
      if (res.status !== 200) return null;
      return res.data.data ?? null;
    } catch {
      return null;
    }
  }

  async getDocument(id: string): Promise<Document | null> {
    try {
      const res = await documentsInfo({ id });
      if (res.status !== 200) return null;
      return res.data.data ?? null;
    } catch {
      return null;
    }
  }

  async createDocument(params: {
    title: string;
    text: string;
    collectionId: string;
    publish: boolean;
    parentDocumentId?: string;
  }): Promise<Document | null> {
    try {
      const res = await documentsCreate(params);
      if (res.status !== 200) return null;
      return res.data.data ?? null;
    } catch {
      return null;
    }
  }

  async updateDocument(params: {
    id: string;
    title: string;
    text: string;
    publish: boolean;
  }): Promise<Document | null> {
    try {
      const res = await documentsUpdate(params);
      if (res.status !== 200) return null;
      return res.data.data ?? null;
    } catch {
      return null;
    }
  }

  async searchDocumentByTitle(
    title: string,
    collectionId: string,
    parentDocumentId?: string
  ): Promise<Document | null> {
    try {
      const res = await documentsSearch({
        query: title,
        collectionId,
        limit: 25,
      });
      if (res.status !== 200) return null;
      const exact = res.data.data?.find(
        (r) =>
          r.document?.title?.toLowerCase() === title.toLowerCase() &&
          (r.document?.parentDocumentId ?? undefined) === parentDocumentId
      );
      return exact?.document ?? null;
    } catch {
      return null;
    }
  }

  async createAttachment(params: {
    name: string;
    contentType: string;
    size: number;
    documentId?: string;
  }): Promise<AttachmentsCreate200Data | null> {
    try {
      const res = await attachmentsCreate(params);
      if (res.status !== 200) return null;
      return res.data.data ?? null;
    } catch {
      return null;
    }
  }

  abstract uploadAttachmentToStorage(
    uploadUrl: string,
    form: Record<string, unknown>,
    fileData: ArrayBuffer,
    contentType: string
  ): Promise<boolean>;

  // ─── Bidirectional sync ────────────────────────────────────────────────

  async listDocuments(params: {
    parentDocumentId?: string;
    collectionId?: string;
    offset?: number;
    limit?: number;
  }): Promise<Document[] | null> {
    try {
      const body: Parameters<typeof documentsList>[0] = {
        offset: params.offset ?? 0,
        limit: params.limit ?? 100,
      };
      if (params.parentDocumentId) body.parentDocumentId = params.parentDocumentId;
      if (params.collectionId) body.collectionId = params.collectionId;
      const res = await documentsList(body);
      if (res.status !== 200) return null;
      return res.data.data ?? [];
    } catch {
      return null;
    }
  }

  async getCollectionDocumentTree(collectionId: string): Promise<NavigationNode[] | null> {
    try {
      const res = await collectionsDocuments({ id: collectionId });
      if (res.status !== 200) return null;
      const data = res.data.data;
      // The schema is loose about array vs single node; normalize to array.
      if (Array.isArray(data)) return data as NavigationNode[];
      if (data && typeof data === 'object') return [data as NavigationNode];
      return [];
    } catch {
      return null;
    }
  }

  async getCollection(id: string): Promise<Collection | null> {
    try {
      const res = await collectionsInfo({ id });
      if (res.status !== 200) return null;
      return res.data.data ?? null;
    } catch {
      return null;
    }
  }

  async deleteDocument(id: string): Promise<boolean> {
    try {
      const res = await documentsDelete({ id });
      return res.status === 200;
    } catch {
      return false;
    }
  }
}
