import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { AuthService } from 'src/app/core/services/auth.service';
import { BookImage, BooksService, Libro } from 'src/app/core/services/books.service';
import { environment } from 'src/environments/environment';

@Component({
  standalone: true,
  selector: 'app-catalog',
  templateUrl: './catalog.page.html',
  styleUrls: ['./catalog.page.scss'],
  imports: [IonicModule, CommonModule, RouterModule],
})
export class CatalogPage implements OnInit {
  // Datos
  books: Libro[] = [];
  private filtered: Libro[] = [];
  visibleBooks: Libro[] = [];

  // Filtros
  genres: string[] = [];
  activeGenre: string | null = null;

  ownerRatings: Record<number, { avg: number | null; count: number }> = {};
  // UI
  loading = true;
  pageSize = 8;
  skeletonItems = Array.from({ length: 8 });
  imageLoaded: Record<number, boolean> = {};

  // Cache portadas
  private covers = new Map<number, string>();
  private coverRequested = new Set<number>();

  // Fallback
  private readonly FALLBACK_ASSET = 'assets/librodefecto.png';

  constructor(
    private booksSvc: BooksService,
    private router: Router,
    private auth: AuthService,
  ) { }

  ngOnInit() { this.loadBooks(); }

  // --------- Carga principal ---------
  loadBooks(event?: any) {
    if (!event) this.loading = true;

    this.booksSvc.listDistinct().subscribe({
      next: async (libros) => {
        const disponibles = (libros || []).filter((b: any) =>
          b.public_disponible === true ||
          (b.disponible && !b.en_negociacion)
        );

        this.books = disponibles;
        this.recomputeGenres();
        this.applyFilter();

        // precarga portadas para la primera página visible
        await this.preloadVisibleCovers();
        await this.preloadOwnerRatingsForVisible();

        this.loading = false;
        const target = (event as any)?.target;
        if (target?.complete) target.complete();
      },
      error: (err) => {
        console.error('Error cargando catálogo', err);
        this.loading = false;
        const target = (event as any)?.target;
        if (target?.complete) target.complete();
      },
    });
  }

  private async preloadOwnerRatingsForVisible() {
    // IDs de dueños que están en visibleBooks y aún no tenemos en cache
    const ids = Array.from(
      new Set(
        this.visibleBooks
          .map(b => b.owner_id)
          .filter((id): id is number =>
            typeof id === 'number' &&
            !Number.isNaN(id) &&
            !(id in this.ownerRatings)
          )
      )
    );

    if (!ids.length) return;

    // Los pedimos uno por uno (para MVP está bien)
    for (const id of ids) {
      try {
        // 👇 SIN firstValueFrom, porque ya es Promise
        const p = await this.auth.getUserProfile(id);
        this.ownerRatings[id] = {
          avg: p.rating_avg ?? null,
          count: p.rating_count ?? 0,
        };
      } catch {
        this.ownerRatings[id] = { avg: null, count: 0 };

        
      }
    }
  }


  // --------- Pull to refresh ---------
  doRefresh(event: any) {
    this.imageLoaded = {};
    this.covers.clear();
    this.coverRequested.clear();
    this.loadBooks(event);
  }

  // --------- Infinite scroll ---------
  loadMore(event: any) {
    const start = this.visibleBooks.length;
    const end = start + this.pageSize;
    this.visibleBooks = this.visibleBooks.concat(this.filtered.slice(start, end));

    // precarga de las nuevas visibles
    this.preloadVisibleCovers();
    this.preloadOwnerRatingsForVisible();

    const target = (event as any)?.target;
    if (target?.complete) target.complete();
    if (this.visibleBooks.length >= this.filtered.length && target) target.disabled = true;
  }

  private applyFilter() {
    this.filtered = this.activeGenre
      ? this.books.filter((b: any) => b.genero_nombre === this.activeGenre)
      : this.books.slice();

    this.visibleBooks = this.filtered.slice(0, this.pageSize);
  }

  private recomputeGenres() {
    this.genres = Array.from(
      new Set((this.books || []).map((b: any) => b.genero_nombre).filter(Boolean))
    ).sort();
  }

  selectGenre(g: string | null) {
    if (this.activeGenre === g) return;
    this.activeGenre = g;
    this.imageLoaded = {};
    this.applyFilter();
    this.preloadVisibleCovers();
    this.preloadOwnerRatingsForVisible(); // 👈
  }

  trackByBookId(_index: number, item: Libro) { return item.id; }

  // --------- Navegación ---------
  goToBook(book: Libro) { this.router.navigate(['/books', 'view', book.id]); }
  onOwnerClick(ev: Event, book: any) {
    ev.stopPropagation();
    if (!book.owner_id) return;
    this.router.navigate(['/users', book.owner_id, 'summary']);
  }

  // ======================================================
  // ============== PORTADAS (como en Intercambio) ========
  // ======================================================

  /** Devuelve la URL a mostrar y dispara precarga si hace falta */
  cover(b: Libro): string {
    const id = Number((b as any)?.id);
    if (id && this.covers.has(id)) return this.covers.get(id)!;

    // 1) intentamos con campos del libro
    const raw =
      (b as any)?.first_image ||
      (b as any)?.cover ||
      (b as any)?.cover_url ||
      (b as any)?.portada ||
      (b as any)?.imagen || '';

    const guess = this.normalizeImg(raw);
    if (guess && guess !== this.FALLBACK_ASSET) {
      if (id) this.covers.set(id, guess);
    }

    // 2) si no hay URL fiable, pedimos al backend la primera imagen (url_abs)
    if (id && !this.coverRequested.has(id)) {
      this.coverRequested.add(id);
      this.booksSvc.listImages(id).subscribe({
        next: (imgs: BookImage[]) => {
          const abs = (imgs?.[0]?.url_abs || '').trim();
          const final = this.normalizeImg(abs) || guess || this.FALLBACK_ASSET;
          this.covers.set(id, final);
          Promise.resolve().then(() => (this.covers = new Map(this.covers)));
        },
        error: () => {
          const final = guess || this.FALLBACK_ASSET;
          this.covers.set(id, final);
          Promise.resolve().then(() => (this.covers = new Map(this.covers)));
        },
      });
    }

    return guess || this.FALLBACK_ASSET;
  }

  private async preloadVisibleCovers() {
    const ids: number[] = [];
    for (const b of this.visibleBooks) {
      const id = Number((b as any)?.id);
      if (!id || this.covers.has(id) || this.coverRequested.has(id)) continue;
      this.coverRequested.add(id);
      ids.push(id);
    }
    if (!ids.length) return;

    const fetchOne = async (bookId: number) => {
      try {
        const imgs = await firstValueFrom(this.booksSvc.listImages(bookId));
        const abs = (imgs?.[0]?.url_abs || '').trim();
        const final = this.normalizeImg(abs) || this.FALLBACK_ASSET;
        this.covers.set(bookId, final);
      } catch {
        this.covers.set(bookId, this.FALLBACK_ASSET);
      }
    };

    // 🧠 máx 3 al mismo tiempo
    const POOL = 3;
    let i = 0;
    const workers = Array.from({ length: Math.min(POOL, ids.length) }, async () => {
      while (i < ids.length) await fetchOne(ids[i++]);
    });
    await Promise.all(workers);
  }

  private normalizeImg(u?: string | null): string {
    const url = (u || '').trim();
    if (!url) return this.FALLBACK_ASSET;

    // absoluta
    if (/^(https?:|capacitor:|file:)/i.test(url)) return url;
    if (url.startsWith('//')) return window.location.protocol + url;

    // /media/... o /static/...
    if (url.startsWith('/media') || url.startsWith('/static') || url.startsWith('/uploads')) {
      return this.getBaseOrigin() + url;
    }
    // media/... etc.
    if (url.startsWith('media/') || url.startsWith('static/') || url.startsWith('uploads/')) {
      return this.getBaseOrigin() + '/' + url;
    }

    // relativa -> cuélgala de mediaBase
    const base = (environment as any).mediaBase
      ? String((environment as any).mediaBase).replace(/\/$/, '')
      : '';
    if (base) {
      const clean = url.replace(/^\/?media\//, '').replace(/^\/+/, '');
      return `${base}/${clean}`;
    }
    return url || this.FALLBACK_ASSET;
  }

  private getBaseOrigin(): string {
    try {
      const base = (environment as any).apiUrl || '/';
      return new URL(base, window.location.origin).origin;
    } catch { return window.location.origin; }
  }

  onImageLoaded(id: number) { this.imageLoaded[id] = true; }
  onImageError(id: number) { this.imageLoaded[id] = true; }

  // --------- Estado y rating ---------
  estadoClass(estado?: string): string {
    const key = (estado || '').toLowerCase();
    if (key.includes('nuevo')) return 'estado-nuevo';
    if (key.includes('bueno')) return 'estado-bueno';
    if (key.includes('regular')) return 'estado-regular';
    if (key.includes('malo') || key.includes('deteriorado')) return 'estado-malo';
    return 'estado-default';
  }
  hasRating(book: any): boolean {
  const ownerId = Number(book?.owner_id);
  const cached = !Number.isNaN(ownerId) ? this.ownerRatings[ownerId] : undefined;

  const avg = cached
    ? Number(cached.avg)
    : Number(book?.owner_rating_avg);

  const count = cached
    ? Number(cached.count)
    : Number(book?.owner_rating_count ?? 0);

  return !Number.isNaN(avg) && count > 0;
}

ratingValue(book: any): string {
  const ownerId = Number(book?.owner_id);
  const cached = !Number.isNaN(ownerId) ? this.ownerRatings[ownerId] : undefined;

  const avg = cached
    ? Number(cached.avg)
    : Number(book?.owner_rating_avg);

  if (Number.isNaN(avg)) return '';
  return avg.toFixed(1);
}

// 👇 NUEVO
ratingCount(book: any): number {
  const ownerId = Number(book?.owner_id);
  const cached = !Number.isNaN(ownerId) ? this.ownerRatings[ownerId] : undefined;

  const count = cached
    ? Number(cached.count)
    : Number(book?.owner_rating_count ?? 0);

  return Number.isNaN(count) ? 0 : count;
}
}
