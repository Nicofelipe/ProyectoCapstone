import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { firstValueFrom, forkJoin, of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from 'src/app/core/services/auth.service';
import { RefreshableContentComponent } from 'src/app/shared/refreshable-content/refreshable-content.component';
import { BooksService, Genero, Libro } from '../../core/services/books.service';

// Web Components de Swiper
import { register } from 'swiper/element/bundle';
register();

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, RefreshableContentComponent],
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class HomePage implements OnInit, OnDestroy {
  q = '';
  ultimos: Libro[] = [];

  loading = false;


  generos: Genero[] = [];
  librosPorGenero: Libro[] = [];
  generoSeleccionado: number | null = null;
  loadingGenero = false;

  // Variable de estado para la búsqueda
  isSearching = false;

  private apiOriginGuess: string | null = null;

  private sub?: Subscription;
  meId: number | null = null;

  // Cache de portadas (por id) + guard para no disparar muchas requests
  private covers: Record<number, string> = {};
  private coverRequested = new Set<number>();

  // ---------- Filtros de visibilidad ----------

  private isBookVisible(b: Libro): boolean {
    // Solo mostramos libros realmente disponibles para el público:
    // - disponible !== false
    // - public_disponible !== false
    if (b.disponible === false) return false;
    if (b.public_disponible === false) return false;
    return true;
  }

  private filterVisible(arr: Libro[] | null | undefined): Libro[] {
    return (arr || []).filter(b => this.isBookVisible(b));
  }


  // Fallbacks
  readonly FALLBACK_ASSET = 'assets/icon/librodefecto.png';
  readonly FALLBACK_SERVER_PATH = '/media/books/librodefecto.png';

  constructor(
    private books: BooksService,
    private router: Router,
    private auth: AuthService,
    private route: ActivatedRoute
  ) { }

  // ---------- Helpers de usuario ----------
  private asNumber(v: any): number | null {
    if (typeof v === 'number') return v;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  isMe(ownerId: any): boolean {
    const a = this.asNumber(ownerId);
    const b = this.asNumber(this.meId);
    return a != null && b != null && a === b;
  }

  // ---------- Init / Destroy ----------
  async ngOnInit() {
    await this.auth.restoreSession();
    this.meId = this.auth.user?.id ?? null;
    this.sub = this.auth.user$.subscribe(u => (this.meId = u?.id ?? null));

    await this.reload();
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  // ---------- Carga de datos (CORREGIDA) ----------
  async reload() {
    // Resetea el estado de búsqueda
    this.q = '';
    this.isSearching = false;

    this.loading = true;


    // Resetea el estado del filtro de género
    this.loadingGenero = true; // Lo ponemos en true ANTES de la llamada
    this.generoSeleccionado = null;
    this.librosPorGenero = [];

    try {
      const ult$ = this.books.latest().pipe(catchError(() => of([])));

      const gen$ = this.books.listGeneros().pipe(catchError(() => of([]))); // Ya tiene la URL corregida

      const [ult, gen] = await firstValueFrom(forkJoin([ult$, gen$]));

      // 👇 Solo libros visibles (disponibles para el catálogo público)
      this.ultimos = this.filterVisible(ult as Libro[]);

      this.generos = gen;

      if (this.generos.length > 0) {
        // Ahora esperamos (await) a que el primer género se cargue
        await this.seleccionarGenero(this.generos[0].id_genero);
      } else {
        // Si no hay géneros, dejamos de cargar
        this.loadingGenero = false;
      }

    } catch (e) {
      console.error('Error recargando datos', e);
      this.loadingGenero = false; // Detenemos la carga si hay error
    } finally {
      this.loading = false;

      // loadingGenero ya se maneja dentro del try/catch y seleccionarGenero
    }
  }

  async seleccionarGenero(id: number | null) {
    // Evita recargar si se hace clic en el mismo género
    if (this.generoSeleccionado === id) {
      return;
    }

    this.generoSeleccionado = id;
    this.librosPorGenero = []; // Limpia los resultados anteriores

    // Si 'id' es 'null', ya no debería pasar, pero lo dejamos por seguridad.
    if (id === null) {
      this.loadingGenero = false;
      return;
    }

    this.loadingGenero = true;
    try {
      const libros = await firstValueFrom(this.books.listByGenre(id));
      this.librosPorGenero = this.filterVisible(libros);
    } catch (err) {
      console.error('Error cargando libros por genero', err);
    } finally {
      this.loadingGenero = false;
    }
  }

  // ---------- Normalización de URLs ----------
  private getApiOriginFallback(): string {
    if (this.apiOriginGuess) return this.apiOriginGuess;
    const svcAny: any = this.books as any;
    const api = svcAny?.api;
    const candidates: Array<string | undefined> = [
      typeof api?.getBaseOrigin === 'function' ? api.getBaseOrigin() : undefined,
      api?.BASE_URL,
      (api?.base ?? api?.baseUrl ?? api?.apiBase) as string | undefined,
      svcAny?.BASE_URL as string | undefined,
      svcAny?.baseUrl as string | undefined,
    ].filter(Boolean);
    for (const c of candidates) {
      try {
        const origin = new URL(String(c)).origin;
        if (origin) return origin;
      } catch { /* ignore */ }
    }
    return window.location.origin;
  }

  private fallbackServerUrl(): string {
    return this.getApiOriginFallback() + this.FALLBACK_SERVER_PATH;
  }

  private fallback(): string {
    return this.fallbackServerUrl() || this.FALLBACK_ASSET;
  }

  private normalizeImg(u?: string | null): string {
    const url = (u || '').trim();
    if (!url) return this.fallback();
    if (/^(https?:|capacitor:|file:)/i.test(url)) {
      try { this.apiOriginGuess = new URL(url).origin; } catch { }
      return url;
    }
    if (url.startsWith('//')) return window.location.protocol + url;
    if (url.startsWith('/media') || url.startsWith('/static') || url.startsWith('/uploads'))
      return this.getApiOriginFallback() + url;
    if (url.startsWith('media/') || url.startsWith('static/') || url.startsWith('uploads/'))
      return this.getApiOriginFallback() + '/' + url;
    if (url.startsWith('/')) return this.getApiOriginFallback() + url;
    return url || this.fallback();
  }

  // ---------- Portadas ----------
  cover(b: Libro): string {
    const id = Number((b as any)?.id);
    if (id && this.covers[id]) return this.covers[id];

    const rawGuess =
      (b as any)?.first_image ||
      (b as any)?.cover ||
      (b as any)?.cover_url ||
      (b as any)?.portada ||
      (b as any)?.imagen ||
      '';

    const guess = this.normalizeImg(rawGuess);
    if (guess && guess !== this.fallback()) {
      if (id) this.covers[id] = guess;
      return guess;
    }

    if (id && !this.coverRequested.has(id)) {
      this.coverRequested.add(id);
      this.books.listImages(id).subscribe({
        next: (imgs) => {
          const raw = (imgs?.[0]?.url_abs || imgs?.[0]?.url_imagen || '').trim();
          const url = this.normalizeImg(raw);
          this.covers[id] = url || this.fallback();
          Promise.resolve().then(() => (this.covers = { ...this.covers }));
        },
        error: () => {
          this.covers[id] = this.fallback();
          Promise.resolve().then(() => (this.covers = { ...this.covers }));
        },
      });
    }
    return this.fallback();
  }

  private preloadCovers(arr: Libro[]) {
    for (const b of arr) {
      const id = Number((b as any)?.id);
      if (!id || this.covers[id] || this.coverRequested.has(id)) continue;
      this.coverRequested.add(id);
      this.books.listImages(id).subscribe({
        next: (imgs) => {
          const raw = (imgs?.[0]?.url_abs || imgs?.[0]?.url_imagen || '').trim();
          const url = this.normalizeImg(raw);
          this.covers[id] = url || this.fallback();
        },
        error: () => {
          this.covers[id] = this.fallback();
        },
      });
    }
    Promise.resolve().then(() => (this.covers = { ...this.covers }));
  }

  onImgError(ev: Event) {
    const img = ev.target as HTMLImageElement | null;
    if (!img) return;
    if (img.getAttribute('data-fallback') === '1') return;
    img.setAttribute('data-fallback', '1');
    img.src = this.fallback();
  }

  async doRefresh(ev: CustomEvent) {
    await this.reload();
    (ev.target as HTMLIonRefresherElement).complete();
  }

  // ---------- Navegación ----------
  goBook(id?: number) {
    if (!id) return;
    this.router.navigate(['/books', 'view', id], {
      state: { from: this.router.url },
    });
  }

  goUser(id?: number | string | null) {
    const ownerId = Number(id);
    if (!ownerId) return;
    const myId = Number(this.meId ?? NaN);
    const isMe = !Number.isNaN(myId) && ownerId === myId;
    const target = isMe ? ['/my-books', 'profile'] : ['/users', ownerId];
    this.router.navigate(target, { state: { from: this.router.url } });
  }

  goTitle(title: string) {
    if (!title) return;
    this.router.navigate(['/books', 'title', encodeURIComponent(title)], {
      state: { from: this.router.url },
    });
  }

  // ---------- Búsqueda (CORREGIDA) ----------
  buscar() {
    // Si la búsqueda está vacía, resetea la vista
    if (!this.q || !this.q.trim()) {
      if (this.isSearching) { // Solo recarga si ESTABA buscando
        this.isSearching = false;
        this.reload(); // Vuelve a la vista normal
      }
      return;
    }

    this.isSearching = true; // Activa el "modo búsqueda"
    this.loading = true; // Usa el spinner de "Últimos agregados"

    this.books.list(this.q).subscribe({
  next: (data) => {
    // Solo resultados realmente visibles en el catálogo
    this.ultimos = this.filterVisible(data);
    this.loading = false;
  },
  error: () => {
    this.loading = false;
    this.ultimos = [];
  },
});
  }

  // ---------- TrackBy ----------
  trackByLibro = (_: number, item: Libro) => item.id;

  trackByGenero = (_: number, item: Genero) => item.id_genero;
}