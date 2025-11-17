import { Injectable } from '@angular/core';
import { interval, Observable, scan, startWith, switchMap, tap } from 'rxjs';
import { ChatMessage, ChatService } from './chat.service';

@Injectable({ providedIn: 'root' })
export class RealtimeService {
  constructor(private chat: ChatService) {}

  /**
   * Emite lotes de mensajes NUEVOS cada N ms y a la vez mantiene un
   * acumulado para que el suscriptor siempre tenga la lista completa.
   */
  watchConversation(convId: number, ms = 2500): Observable<ChatMessage[]> {
    let last = 0;

    return interval(ms).pipe(
      startWith(0), // dispara de inmediato
      switchMap(() => this.chat.listMessages(convId, last)),
      tap((batch) => {
        if (batch && batch.length) {
          last = batch[batch.length - 1].id_mensaje;
        }
      }),
      // acumulamos sin duplicar por id_mensaje
      scan((acc: ChatMessage[], batch: ChatMessage[]) => {
        if (!batch?.length) return acc;
        const seen = new Set(acc.map(m => m.id_mensaje));
        const merged = [...acc];
        for (const m of batch) if (!seen.has(m.id_mensaje)) merged.push(m);
        return merged;
      }, [] as ChatMessage[])
    );
  }
}