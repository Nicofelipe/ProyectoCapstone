import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import ApiService from './api.service';

export interface Genero {
  id_genero: number;
  nombre: string;
}

export interface MyBookCard {
  id: number;
  titulo: string;
  autor: string;
  estado: string;
  descripcion: string;
  editorial: string;
  genero: string;
  /** 👇 nuevo: viene del backend en /api/books/mine/ */
  genero_nombre?: string | null;
  tipo_tapa: string;
  disponible: boolean;
  fecha_subida: string;
  first_image?: string | null;
  has_requests: boolean;
  comuna_nombre?: string | null;
  has_new_requests?: boolean;
  editable?: boolean;
  intercambio_estado?: 'Pendiente' | 'Aceptado' | 'Rechazado' | 'Completado' | string | null;
  estado_intercambio?: string | null; // nombre real que manda el backend
  status_reason?: 'OWNER' | 'BAJA' | 'COMPLETADO' | string | null;
  en_negociacion?: boolean;
}

export type SolicitarGuard = { allowed: boolean; reason?: string };

export interface BookHistoryItem {
  id: number;
  estado: 'Pendiente' | 'Aceptado' | 'Rechazado' | 'Completado' | string;
  fecha?: string;
  rol: 'ofrecido' | 'solicitado';
  counterpart_user_id?: number | null;
  counterpart_user?: string | null;
  counterpart_book_id?: number | null;
  counterpart_book?: string | null;
}

export interface MyBookWithHistory extends MyBookCard {
  counters: { total: number; completados: number; pendientes: number; aceptados: number; rechazados: number };
  history: BookHistoryItem[];
}

export interface RawLibro {
  id_libro: number;
  titulo: string;
  autor: string;
  estado?: string;
  descripcion?: string;
  editorial?: string;
  genero?: string;                 // legacy
  genero_nombre?: string | null;   // nuevo
  id_genero?: number | null;       // nuevo
  tipo_tapa?: string;
  owner_nombre?: string;
  owner_id?: number;
  fecha_subida?: string;
  disponible?: boolean;
  isbn?: string | null;
  anio_publicacion?: number | null;
  en_negociacion?: boolean;
  public_disponible?: boolean;
  first_image?: string | null;
  owner_rating_avg?: number | null;
  owner_rating_count?: number;
}

export interface Libro {
  id: number;
  titulo: string;
  autor: string;
  estado?: string;
  descripcion?: string;
  editorial?: string;
  genero?: string;                 // legacy
  genero_nombre?: string | null;   // nuevo
  id_genero?: number | null;       // nuevo
  tipo_tapa?: string;
  owner_nombre?: string;
  owner_id?: number;
  fecha_subida?: string;
  disponible?: boolean;
  isbn?: string | null;
  anio_publicacion?: number | null;
  en_negociacion?: boolean;
  public_disponible?: boolean;
  first_image?: string | null;         // portada (ya viene absoluta del backend)
  owner_rating_avg?: number | null;    // promedio de calificación del dueño
  owner_rating_count?: number;         // cantidad de calificaciones
}

export interface PopularItem {
  titulo: string;
  total_intercambios: number;
  repeticiones: number;
}

export interface BookImage {
  id_imagen: number;
  url_imagen: string;
  url_abs: string;
  descripcion: string;
  orden?: number | null;
  is_portada?: boolean;
  created_at?: string | null;
}

export interface OwnerMini {
  id: number;
  nombre_usuario: string;
  rating_avg: number | null;
  rating_count: number;
}

export interface BookByTitleItem {
  id: number;
  titulo: string;
  autor: string;
  estado: string;
  fecha_subida?: string;
  disponible?: boolean;
  first_image?: string | null;
  owner: OwnerMini;
}

const mapLibro = (r: any): Libro => ({
  id: Number(r?.id_libro ?? r?.id ?? r?.pk ?? 0),
  titulo: r?.titulo ?? '',
  autor: r?.autor ?? '',
  estado: r?.estado ?? undefined,
  descripcion: r?.descripcion ?? undefined,
  editorial: r?.editorial ?? undefined,
  genero: r?.genero,
  genero_nombre: r?.genero_nombre ?? null,
  id_genero: r?.id_genero ?? null,
  tipo_tapa: r?.tipo_tapa ?? undefined,
  owner_nombre: r?.owner_nombre,
  owner_id: r?.owner_id,
  fecha_subida: r?.fecha_subida,
  disponible: r?.disponible,
  isbn: r?.isbn ?? null,
  anio_publicacion: r?.anio_publicacion ?? null,
  en_negociacion: !!r?.en_negociacion,
  public_disponible: r?.public_disponible ?? undefined,
  first_image: r?.first_image ?? null,

  // 👇 IMPORTANTE: casteamos a número
  owner_rating_avg:
    r?.owner_rating_avg !== undefined && r?.owner_rating_avg !== null
      ? Number(r.owner_rating_avg)
      : null,
  owner_rating_count:
    r?.owner_rating_count !== undefined && r?.owner_rating_count !== null
      ? Number(r.owner_rating_count)
      : 0,
});

const normalize = (s: string) =>
  (s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const sortByNewest = (a: Libro, b: Libro) => {
  const ta = a.fecha_subida ? new Date(a.fecha_subida).getTime() : 0;
  const tb = b.fecha_subida ? new Date(b.fecha_subida).getTime() : 0;
  if (ta !== tb) return tb - ta;
  return b.id - a.id;
};

const dedupByTitle = (arr: Libro[]): Libro[] => {
  const out: Libro[] = [];
  const seen = new Set<string>();
  for (const item of arr.sort(sortByNewest)) {
    const key = normalize(item.titulo);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
};

@Injectable({ providedIn: 'root' })
export class BooksService {
  constructor(private api: ApiService) { }

  // ===== Catálogo / géneros =====
  listGeneros(): Observable<Genero[]> {
    // backend: /api/catalog/generos/
    return this.api.get<Genero[]>('/api/catalog/generos/');
  }

  // Lista general (no filtra en_negociacion: eso lo hace el backend
  // en endpoints especiales como latest y catalogo_completo)
  list(q = ''): Observable<Libro[]> {
    const options = q ? { params: { query: q } } : undefined;
    return this.api.get<RawLibro[]>('/api/libros/', options).pipe(
      map((arr) => arr.map(mapLibro))
    );
  }

  listDistinct(q = ''): Observable<Libro[]> {
    return this.list(q).pipe(map(dedupByTitle));
  }

  // Últimos libros disponibles y sin negociación (backend ya filtra)
  latest(userId?: number | null): Observable<Libro[]> {
    const params: any = {};
    if (userId != null) {
      params.user_id = userId;
    }

    return this.api
      .get<RawLibro[]>('/api/libros/latest/', { params })
      .pipe(map((arr) => arr.map(mapLibro)));
  }

  // Por género (también filtra disponible + no en_negociacion en el backend)
  listByGenre(id_genero: number, userId?: number | null): Observable<Libro[]> {
    const params: any = { id_genero };
    if (userId != null) {
      params.user_id = userId;
    }

    return this.api
      .get<RawLibro[]>('/api/libros/por-genero/', { params })
      .pipe(map((arr) => arr.map(mapLibro)));
  }

  // Populares por título (estadística)
  populares(): Observable<PopularItem[]> {
    return this.api.get<PopularItem[]>('/api/libros/populares/');
  }

  // Detalle de libro por ID (incluye en_negociacion, etc.)
  get(id: number): Observable<Libro> {
    return this.api.get<RawLibro>(`/api/libros/${id}/`).pipe(map(mapLibro));
  }

  // ===== Libros propios =====
  getMine(userId: number) {
    return this.api.get<MyBookCard[]>('/api/books/mine/', {
      params: { user_id: userId },
    });
  }

  getMineWithHistory(userId: number, limit = 10): Observable<MyBookWithHistory[]> {
    return this.api.get<MyBookWithHistory[]>('/api/books/mine-with-history/', {
      params: { user_id: userId, limit },
    });
  }

  create(data: any) {
    return this.api.post<{ id: number; id_libro?: number }>(
      '/api/libros/create/',
      data
    );
  }

  updateBook(
    libroId: number,
    data: Partial<MyBookCard & { isbn?: string; anio_publicacion?: number }>
  ) {
    return this.api.patch(`/api/libros/${libroId}/update/`, data);
  }

  ownerToggle(libroId: number, activar: boolean) {
    return this.api.patch<{ id: number; disponible: boolean; status_reason: string }>(
      `/api/libros/${libroId}/owner-toggle/`,
      { disponible: activar } // ó { activar }
    );
  }

  // ===== Lógica para botón "Solicitar" =====
  canSolicitar(
    book: Libro,
    meId: number,
    ocupadosOfrecidos: number[], // viene de IntercambiosService.librosOfrecidosOcupados()
    yaPediEsteLibro: boolean    // viene de IntercambiosService.yaSoliciteEsteLibro()
  ): SolicitarGuard {
    if (!book.disponible) {
      return { allowed: false, reason: 'No disponible' };
    }
    if (book.en_negociacion) {
      return { allowed: false, reason: 'En negociación' };
    }
    if (book.owner_id === meId) {
      return { allowed: false, reason: 'Es tu publicación' };
    }
    if (yaPediEsteLibro) {
      return { allowed: false, reason: 'Ya tienes una solicitud pendiente/aceptada' };
    }
    // El tema de ocupadosOfrecidos lo manejas en el selector de libro ofrecido
    // (para que ahí no puedas elegir un libro ocupado).
    return { allowed: true };
  }

  // ===== Imágenes =====
  uploadImage(
    libroId: number,
    file: File,
    opts?: { descripcion?: string; orden?: number; is_portada?: boolean }
  ) {
    const fd = new FormData();
    fd.append('image', file); // backend espera 'image'
    if (opts?.descripcion) fd.append('descripcion', opts.descripcion);
    if (opts?.orden != null) fd.append('orden', String(opts.orden));
    if (opts?.is_portada != null) fd.append('is_portada', opts.is_portada ? '1' : '0');
    return this.api.post(`/api/libros/${libroId}/images/upload/`, fd);
  }

  listImages(libroId: number) {
    return this.api.get<BookImage[]>(`/api/libros/${libroId}/images/`);
  }

  setCover(imagenId: number, isPortada: boolean) {
    return this.api.patch(`/api/images/${imagenId}/`, {
      is_portada: isPortada ? 1 : 0,
    });
  }

  deleteImage(imagenId: number) {
    return this.api.delete(`/api/images/${imagenId}/delete/`);
  }

  markRequestsSeen(libroId: number, userId: number) {
    return this.api.post(`/api/libros/${libroId}/solicitudes/vistas/`, null, {
      params: { user_id: userId },
    });
  }

  deleteBook(libroId: number) {
    return this.api.delete(`/api/libros/${libroId}/delete/`);
  }

  // ===== Event bus para "Mis libros" =====
  private myBooksEvents = new Subject<
    | { type: 'cover-changed'; bookId: number; url: string }
    | { type: 'deleted'; bookId: number }
    | { type: 'created'; book: MyBookCard }
    | { type: 'requests-seen'; bookId: number }
  >();

  public myBooksEvents$ = this.myBooksEvents.asObservable();

  emitCoverChanged(bookId: number, url: string) {
    this.myBooksEvents.next({ type: 'cover-changed', bookId, url });
  }

  emitDeleted(bookId: number) {
    this.myBooksEvents.next({ type: 'deleted', bookId });
  }

  emitCreated(book: MyBookCard) {
    this.myBooksEvents.next({ type: 'created', book });
  }

  emitRequestsSeen(bookId: number) {
    this.myBooksEvents.next({ type: 'requests-seen', bookId });
  }

  // ===== Búsqueda por título exacto =====
  listByTitle(title: string) {
    return this.api.get<BookByTitleItem[]>('/api/libros/by-title/', {
      params: { title },
    });
  }

  // ===== (Legacy) crear intercambio directo =====
  createIntercambio(payload: {
    id_usuario_solicitante: number;
    id_libro_ofrecido: number;
    id_usuario_ofreciente: number;
    id_libro_solicitado: number;
    lugar_intercambio: string;
    fecha_intercambio?: string;
  }) {
    return this.api.post<{ id_intercambio: number }>(
      '/api/intercambios/create/',
      payload
    );
  }
}
