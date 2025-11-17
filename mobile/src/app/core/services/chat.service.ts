// src/app/core/services/chat.service.ts
import { HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import ApiService from './api.service';

export type ChatMessage = {
  id_mensaje: number;
  id_conversacion: number;
  id_usuario_emisor: number;   // mapeado desde emisor_id
  cuerpo: string;
  enviado_en: string;
  editado_en?: string | null;
  eliminado?: number;
};

export type ConversationSummary = {
  id_conversacion: number;
  actualizado_en: string | null;
  last_body?: string | null;
  counterpart_name?: string | null;
  counterpart_avatar?: string | null;
  unread_count?: number;
  titulo?: string | null;
  my_book_title?: string | null;
  counterpart_book_title?: string | null;

  // 👇 nuevo
  intercambio_estado?: string | null;
  archivado?: boolean;
};

@Injectable({ providedIn: 'root' })
export class ChatService {
  constructor(private api: ApiService) { }

  /** Lista de conversaciones del usuario logueado */
  listConversations(userId: number): Observable<ConversationSummary[]> {
    return this.api
      .get<any[]>(`/api/chat/${userId}/conversaciones/`)
      .pipe(
        map(rows =>
          (rows || []).map(r => {
            const estadoRaw = String(r.intercambio_estado || '').toLowerCase();

            // 👇 REGLA CLARA:
            // solo se consideran “archivados” los COMPLETADOS o CANCELADOS
            const archivado =
              estadoRaw === 'completado' || estadoRaw === 'cancelado';

            return {
              id_conversacion: r.id_conversacion,
              actualizado_en: r.ultimo_enviado_en ?? null,
              last_body: r.ultimo_mensaje ?? null,

              counterpart_name:
                r.otro_usuario?.nombre_usuario ??
                r.otro_usuario?.nombres ??
                null,
              counterpart_avatar: r.otro_usuario?.imagen_perfil ?? null,

              unread_count: r.unread_count ?? 0,
              titulo: r.display_title ?? r.titulo_chat ?? null,
              my_book_title: r.my_book_title ?? r.requested_book_title ?? null,
              counterpart_book_title: r.counterpart_book_title ?? null,

              intercambio_estado: r.intercambio_estado ?? null,
              archivado,
            } as ConversationSummary;
          })
        )
      );
  }

  /** Mensajes de una conversación; usa ?after=<id> */
  listMessages(convId: number, afterId?: number): Observable<ChatMessage[]> {
    let params = new HttpParams();
    if (afterId && afterId > 0) params = params.set('after', String(afterId));

    return this.api
      .get<any[]>(`/api/chat/conversacion/${convId}/mensajes/`, { params })
      .pipe(
        map(arr =>
          (arr || []).map((m: any) => ({
            id_mensaje: m.id_mensaje,
            id_conversacion: convId,
            id_usuario_emisor: Number(m.emisor_id),
            cuerpo: m.cuerpo,
            enviado_en: m.enviado_en,
            editado_en: m.editado_en ?? null,
            eliminado: m.eliminado,
          } as ChatMessage))
        )
      );
  }

  // Detectar si la API nos dijo "solo lectura" (403)
  isReadOnlyError(err: unknown): boolean {
    const e = err as any;
    return !!(e && typeof e === 'object' && Number(e.status) === 403);
  }

  /** Enviar mensaje: requiere id_usuario_emisor */
  sendMessage(convId: number, body: string, emitterUserId: number) {
    return this.api.post<{ id_mensaje: number }>(
      `/api/chat/conversacion/${convId}/enviar/`,
      { id_usuario_emisor: emitterUserId, cuerpo: body }
    );
  }

  /** Marcar conversación como vista por el usuario */
  markSeen(convId: number, userId: number) {
    return this.api.post<{ ultimo_visto_id_mensaje: number }>(
      `/api/chat/conversacion/${convId}/visto/`,
      { id_usuario: userId }
    );
  }
}
