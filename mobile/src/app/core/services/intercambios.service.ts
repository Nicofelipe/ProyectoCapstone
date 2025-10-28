// src/app/core/services/intercambios.service.ts
import { HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import ApiService from './api.service';

export interface SolicitudEntrante {
  id: number;
  solicitante: string | null;
  libro_mio: string | null;
  libro_del_otro: string | null;
  lugar: string | null;
  fecha: string | null;
  estado: string;
}

// Formato mínimo para trabajar con "enviadas"
type OfertaDTO = {
  id_libro_ofrecido?: { id_libro: number } | null;
  id_libro_ofrecido_id?: number | null;
};
type SolicitudEnviadaDTO = {
  id_solicitud?: number;
  estado?: string;
  id_libro_deseado?: { id_libro: number } | null;
  id_libro_deseado_id?: number | null;
  ofertas?: OfertaDTO[];
};

@Injectable({ providedIn: 'root' })
export class IntercambiosService {
  constructor(private api: ApiService) { }

  // === Solicitudes (ofertas 1..3 por libro deseado) ===
  crearSolicitud(payload: {
    id_usuario_solicitante: number;
    id_libro_deseado: number;
    id_libros_ofrecidos: number[];
  }) {
    return this.api.post('/api/solicitudes/crear/', payload);
  }

  /** Alias para que el componente pueda llamarlo como lo usaste allí */
  crearSolicitudIntercambio(payload: {
    id_usuario_solicitante: number;
    id_libro_deseado: number;
    id_libros_ofrecidos: number[];
  }) {
    return this.crearSolicitud(payload);
  }

  aceptarSolicitud(solicitudId: number, userId: number, id_libro_aceptado: number) {
    return this.api.post(`/api/solicitudes/${solicitudId}/aceptar/`, {
      user_id: userId,
      id_libro_aceptado,
    });
  }

  rechazarSolicitud(solicitudId: number, userId: number) {
    return this.api.post(`/api/solicitudes/${solicitudId}/rechazar/`, { user_id: userId });
  }

  cancelarSolicitud(solicitudId: number, userId: number) {
    return this.api.post(`/api/solicitudes/${solicitudId}/cancelar/`, { user_id: userId });
  }

  listarRecibidas(userId: number) {
    return this.api.get('/api/solicitudes/recibidas/', { params: { user_id: userId } });
  }

  listarEnviadas(userId: number) {
    return this.api.get<SolicitudEnviadaDTO[]>('/api/solicitudes/enviadas/', {
      params: { user_id: userId },
    });
  }

  /**
   * (Recomendado si agregaste el endpoint backend)
   * Devuelve los IDs de tus libros que ya están ofrecidos en otras solicitudes PENDIENTES.
   */
  librosOfrecidosOcupados(userId: number): Observable<number[]> {
    const params = new HttpParams().set('user_id', String(userId));
    return this.api
      .get<{ ocupados: number[] }>('/api/solicitudes/ofertas-ocupadas/', { params })
      .pipe(map(r => r?.ocupados ?? []));
  }

  /**
   * Fallback sin endpoint: calcula "ocupados" a partir de /enviadas (estado pendiente).
   * Devuelve un array de IDs de libros ofrecidos actualmente ocupados.
   */
  librosOcupadosDesdeEnviadas(userId: number): Observable<number[]> {
    return this.listarEnviadas(userId).pipe(
      map((rows) => {
        const out = new Set<number>();
        for (const s of rows || []) {
          const estado = (s?.estado || '').toLowerCase();
          if (estado !== 'pendiente') continue;
          for (const ofr of s.ofertas || []) {
            const idLibro =
              ofr?.id_libro_ofrecido?.id_libro ??
              ofr?.id_libro_ofrecido_id ??
              null;
            if (idLibro) out.add(Number(idLibro));
          }
        }
        return Array.from(out);
      })
    );
  }

  /**
   * ¿Ya hay una solicitud PENDIENTE para este mismo libro (como libro deseado)?
   */
  yaSoliciteEsteLibro(userId: number, libroDeseadoId: number) {
    const objetivo = Number(libroDeseadoId);
    return this.listarEnviadas(userId).pipe(
      map((rows: any[]) =>
        (rows || []).some((s: any) => {
          const estado = String(s?.estado_slug ?? s?.estado ?? '').toLowerCase();
          // bloquea si está Pendiente o Aceptada (puedes ampliar si quieres)
          const estadoOk = estado === 'pendiente' || estado === 'aceptada';

          // soporta todas las formas que puede venir desde el serializer
          const lid = Number(
            s?.libro_deseado?.id_libro ??
            s?.libro_deseado?.id ??
            s?.libro_deseado_id ??
            s?.id_libro_deseado_id ??    // por si acaso
            s?.id_libro_deseado?.id_libro ??
            NaN
          );

          return estadoOk && lid === objetivo;
        })
      )
    );
  }

  // === (legacy) Crear intercambio directo uno-a-uno (si lo sigues usando)
  crearIntercambio(payload: {
    id_usuario_solicitante: number;
    id_libro_ofrecido: number;
    id_usuario_ofreciente: number;
    id_libro_solicitado: number;
    lugar_intercambio: string;
    fecha_intercambio?: string;
  }) {
    return this.api.post('/api/intercambios/create/', payload);
  }

  // === Bandeja de entradas (pendientes para mí como ofreciente)
  solicitudesEntrantes(userId: number): Observable<SolicitudEntrante[]> {
    return this.api.get<SolicitudEntrante[]>('/api/intercambios/entrantes/', {
      params: { user_id: userId },
    });
  }

  // === Coordinación del encuentro
  proponerEncuentro(intercambioId: number, userId: number, lugar: string, fecha: string) {
    return this.api.patch(`/api/intercambios/${intercambioId}/proponer/`, {
      user_id: userId,
      lugar,
      fecha, // YYYY-MM-DD
    });
  }

  confirmarEncuentro(intercambioId: number, userId: number, confirmar: boolean) {
    return this.api.patch(`/api/intercambios/${intercambioId}/confirmar/`, {
      user_id: userId,
      confirmar,
    });
  }

  // === Código y cierre
  generarCodigo(intercambioId: number, userId: number, codigo?: string) {
    return this.api.post(`/api/intercambios/${intercambioId}/codigo/`, { user_id: userId, codigo });
  }

  calificar(intercambioId: number, userId: number, puntuacion: number, comentario = ''): Observable<{ok: boolean}> {
    return this.api.post(`/api/intercambios/${intercambioId}/calificar/`, {
      user_id: userId,
      puntuacion,
      comentario,
    });
  }

  completarConCodigo(intercambioId: number, userId: number, codigo: string, fecha?: string) {
    return this.api.post(`/api/intercambios/${intercambioId}/completar/`, {
      user_id: userId,
      codigo: (codigo || '').trim().toUpperCase(),
      fecha: fecha ?? new Date().toISOString().slice(0, 10), // YYYY-MM-DD
    });
  }

  cancelarIntercambio(intercambioId: number, userId: number) {
    return this.api.post(`/api/intercambios/${intercambioId}/cancelar/`, { user_id: userId });
  }

  
}
