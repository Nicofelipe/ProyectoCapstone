// src/app/pages/requests/requests.page.ts
import { CommonModule } from '@angular/common';
import { Component, computed, OnDestroy, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { AuthService, MeUser } from 'src/app/core/services/auth.service';
import { BookImage, BooksService } from 'src/app/core/services/books.service';
import { IntercambiosService } from 'src/app/core/services/intercambios.service';

type UsuarioLite = { id_usuario: number; nombre_usuario: string | null };
type LibroLite = { id_libro: number; titulo: string; autor?: string | null };
export type OfertaLite = { id_oferta: number; libro_ofrecido: LibroLite };

export type SolicitudDTO = {
  id_solicitud: number;
  estado: string;
  creada_en?: string | null;
  actualizada_en?: string | null;
  solicitante: UsuarioLite;
  receptor: UsuarioLite;
  libro_deseado: LibroLite;
  ofertas: OfertaLite[];
  libro_aceptado?: LibroLite | null;
  chat_enabled?: boolean;
  intercambio_id?: number | null;
  conversacion_id?: number | null;
  lugar_intercambio?: string | null;
  fecha_intercambio_pactada?: string | null;
  fecha_completado?: string | null;
};

type TabKey = 'recibidas' | 'enviadas';
type FiltroKey = 'todas' | 'pendiente' | 'aceptada' | 'canceladas' | 'completada';

@Component({
  selector: 'app-requests',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './requests.page.html',
  styleUrls: ['./requests.page.scss'],
})
export class RequestsPage implements OnInit, OnDestroy {
  me: MeUser | null = null;

  tab = signal<TabKey>('recibidas');
  loading = signal(true);
  recibidas = signal<SolicitudDTO[]>([]);
  enviadas = signal<SolicitudDTO[]>([]);
  filtro = signal<FiltroKey>('todas');

  // ===== Imágenes / caché =====
  private imgCache = new Map<number, string | null>();
  readonly FALLBACK = 'assets/librodefecto.png';

  // Intento de “adivinar” el origen del API (para prefijar /media cuando venga relativo)
  private apiOriginGuess: string | null = null;

  private liveTimer: any = null;
  private readonly LIVE_MS = 4000;

  constructor(
    private auth: AuthService,
    private svc: IntercambiosService,
    private booksSvc: BooksService,
    private router: Router,
    private toast: ToastController,
    private alert: AlertController,
  ) {}

  // ===== Ciclo de vida =====
  async ngOnInit() {
    await this.auth.restoreSession();
    this.me = this.auth.user;
    if (!this.me) {
      this.router.navigateByUrl('/auth/login');
      return;
    }
    await this.load();
    this.startLive();
  }

  ngOnDestroy(): void {
    this.stopLive();
  }

  async ionViewDidEnter() {
    if (!this.me) {
      await this.auth.restoreSession();
      this.me = this.auth.user;
      if (!this.me) return;
    }

    // Marca listado como visto y apaga el puntito rojo global
    this.svc.markAllRequestsAsSeen(this.me.id);
    this.svc.refreshGlobalRequestsBadge(this.me.id);
  }

  // ===== Carga de datos =====
  private async load() {
    if (!this.me) return;
    this.loading.set(true);

    try {
      const [recRaw, envRaw] = await Promise.all([
        firstValueFrom(this.svc.listarRecibidas(this.me.id)) as Promise<unknown>,
        firstValueFrom(this.svc.listarEnviadas(this.me.id)) as Promise<unknown>,
      ]);

      const rec = Array.isArray(recRaw) ? (recRaw as SolicitudDTO[]) : [];
      const env = Array.isArray(envRaw) ? (envRaw as SolicitudDTO[]) : [];

      this.recibidas.set(rec || []);
      this.enviadas.set(env || []);

      // Precarga de imágenes (tanto para recibidas como enviadas)
      const all = [...rec, ...env];
      for (const s of all) {
        await this.preloadFirstImage(this.getMiLibroId(s, 'recibidas'));
        await this.preloadFirstImage(this.getSuLibroId(s, 'recibidas'));
        await this.preloadFirstImage(this.getMiLibroId(s, 'enviadas'));
        await this.preloadFirstImage(this.getSuLibroId(s, 'enviadas'));
      }
    } catch (e: any) {
      (await this.toast.create({
        message: e?.error?.detail || 'No se pudieron cargar las solicitudes',
        duration: 1600,
      })).present();
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshSilently() {
    if (!this.me) return;
    try {
      const [recRaw, envRaw] = await Promise.all([
        firstValueFrom(this.svc.listarRecibidas(this.me.id)) as Promise<unknown>,
        firstValueFrom(this.svc.listarEnviadas(this.me.id)) as Promise<unknown>,
      ]);
      const rec = Array.isArray(recRaw) ? (recRaw as SolicitudDTO[]) : [];
      const env = Array.isArray(envRaw) ? (envRaw as SolicitudDTO[]) : [];
      this.recibidas.set(rec || []);
      this.enviadas.set(env || []);
    } catch {
      // silencioso
    }
  }

  private startLive() {
    this.stopLive();
    this.liveTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      this.refreshSilently();
    }, this.LIVE_MS);
  }

  private stopLive() {
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
  }

  // ===== Helpers de estado =====
  private normalizeEstado = (s?: string | null) =>
    (s ?? '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z]/g, '')
      .trim();

  /**
   * Devuelve un estado "canon":
   * 'pendiente' | 'aceptada' | 'rechazada' | 'cancelada' | 'completada' | 'otro'
   */
  private canonicalEstado = (row: SolicitudDTO): string => {
    const raw = row?.estado ?? '';
    const n = this.normalizeEstado(raw);

    if (n.includes('complet') || n.includes('finaliz') || n.includes('cerrad') || !!row?.fecha_completado)
      return 'completada';
    if (n.includes('pend')) return 'pendiente';
    if (n.includes('acept')) return 'aceptada';
    if (n.includes('rechaz') || n.includes('declin')) return 'rechazada';
    if (n.includes('cancel')) return 'cancelada';
    return n || 'otro';
  };

  /**
   * Mapea el filtro del segment a los estados canónicos.
   * IMPORTANTE: "canceladas" incluye canceladas + rechazadas.
   */
  private pasaFiltroWith(row: SolicitudDTO, f: FiltroKey): boolean {
    if (f === 'todas') return true;
    const ce = this.canonicalEstado(row); // 'pendiente' | 'aceptada' | 'rechazada' | 'cancelada' | 'completada' | 'otro'

    if (f === 'pendiente') return ce === 'pendiente';
    if (f === 'aceptada') return ce === 'aceptada';
    if (f === 'canceladas') return ce === 'cancelada' || ce === 'rechazada';
    if (f === 'completada') return ce === 'completada';

    return true;
  }

  /**
   * Para ordenar: primero por `actualizada_en`, luego `creada_en`.
   */
  private fechaMs(row: SolicitudDTO): number {
    const t = row.actualizada_en || row.creada_en || null;
    return t ? new Date(t).getTime() : 0;
  }

  // ✅ listas filtradas + ordenadas (las más recientes primero)
  filteredRecibidas = computed(() => {
    const f = this.filtro();
    return this.recibidas()
      .filter(s => this.pasaFiltroWith(s, f))
      .slice()
      .sort((a, b) => this.fechaMs(b) - this.fechaMs(a));
  });

  filteredEnviadas = computed(() => {
    const f = this.filtro();
    return this.enviadas()
      .filter(s => this.pasaFiltroWith(s, f))
      .slice()
      .sort((a, b) => this.fechaMs(b) - this.fechaMs(a));
  });

  colorEstado(est: string) {
    const n = this.normalizeEstado(est);
    if (n.includes('pend')) return 'warning';
    if (n.includes('acept')) return 'success';
    if (n.includes('rechaz') || n.includes('cancel')) return 'danger';
    if (n.includes('complet') || n.includes('finaliz') || n.includes('cerrad')) return 'medium';
    return 'medium';
  }

  // ===== Navegación / acciones =====
  goDetail(row: SolicitudDTO) {
    this.router.navigate(['/requests', row.id_solicitud]);
  }

  showChat(row: SolicitudDTO) {
    const canon = this.canonicalEstado(row);
    return !!row.conversacion_id && canon === 'aceptada';
  }

  openChat(row: SolicitudDTO, ev?: Event) {
    ev?.stopPropagation();
    if (!row.conversacion_id) return;
    this.router.navigate(['/chats', row.conversacion_id]);
  }

  counterpartyName(row: SolicitudDTO, rol: TabKey) {
    const u = rol === 'recibidas' ? row.solicitante : row.receptor;
    return u?.nombre_usuario || '—';
  }

  // ===== Normalizador de URLs de imagen =====
  private getApiOriginFallback(): string {
    const anySvc = this.booksSvc as any;
    const guesses = [
      anySvc?.BASE_URL,
      anySvc?.baseUrl,
      anySvc?.apiBase,
      anySvc?._baseUrl,
    ].filter(Boolean);

    if (this.apiOriginGuess) return this.apiOriginGuess;

    if (guesses.length) {
      try {
        return new URL(String(guesses[0])).origin;
      } catch { }
    }

    return window.location.origin;
  }

  private normalizeImg = (u: string | null | undefined): string => {
    if (!u) return this.FALLBACK;
    const url = String(u).trim();

    if (/^(https?:|capacitor:|file:)/i.test(url)) {
      try { this.apiOriginGuess = new URL(url).origin; } catch { }
      return url;
    }

    if (url.startsWith('//')) return window.location.protocol + url;

    if (url.startsWith('/media') || url.startsWith('/static') || url.startsWith('/uploads')) {
      return this.getApiOriginFallback() + url;
    }

    if (url.startsWith('media/') || url.startsWith('static/') || url.startsWith('uploads/')) {
      return this.getApiOriginFallback() + '/' + url;
    }

    if (url.startsWith('/')) return this.getApiOriginFallback() + url;

    return url || this.FALLBACK;
  };

  // --- Imágenes ---
  private async preloadFirstImage(libroId: number | null) {
    if (!libroId || this.imgCache.has(libroId) || !this.booksSvc) return;
    this.imgCache.set(libroId, null);
    try {
      const imgs = await firstValueFrom(this.booksSvc.listImages(libroId)) as BookImage[];
      const raw = Array.isArray(imgs) && imgs[0]?.url_abs ? String(imgs[0].url_abs) : null;
      const url = this.normalizeImg(raw);
      this.imgCache.set(libroId, url);
    } catch {
      this.imgCache.set(libroId, null);
    }
  }

  private firstImageOf(id: number | null): string | null {
    if (!id) return null;
    return this.imgCache.get(id) ?? null;
  }

  getLibroImagen(id: number | null): string {
    const v = this.firstImageOf(id);
    return this.normalizeImg(v) || this.FALLBACK;
  }

  onImgError(ev: Event) {
    const img = ev.target as HTMLImageElement | null;
    if (!img) return;
    if (img.getAttribute('data-fallback-applied') === '1') return;
    img.setAttribute('data-fallback-applied', '1');
    img.src = this.FALLBACK;
  }

  // --- Libros: IDs/títulos ---
  private getLibroId(libro: LibroLite): number {
    return (libro as any)?.id_libro ?? (libro as any)?.id ?? 0;
  }

  private getOfertaUnica(s: SolicitudDTO): LibroLite | null {
    return s.ofertas?.[0]?.libro_ofrecido ?? null;
  }

  getMiLibroId(s: SolicitudDTO, tab: TabKey): number | null {
    return tab === 'recibidas'
      ? this.getLibroId(s.libro_deseado)
      : this.getLibroId(this.getOfertaUnica(s)!);
  }

  getSuLibroId(s: SolicitudDTO, tab: TabKey): number | null {
    return tab === 'recibidas'
      ? this.getLibroId(this.getOfertaUnica(s)!)
      : this.getLibroId(s.libro_deseado);
  }

  getMiLibroTitulo(s: SolicitudDTO, tab: TabKey): string {
    return tab === 'recibidas'
      ? (s.libro_deseado?.titulo || '...')
      : (this.getOfertaUnica(s)?.titulo || '...');
  }

  getSuLibroTitulo(s: SolicitudDTO, tab: TabKey): string {
    return tab === 'recibidas'
      ? (this.getOfertaUnica(s)?.titulo || '...')
      : (s.libro_deseado?.titulo || '...');
  }

  // --- Acciones rápidas ---
  showQuickActions(s: SolicitudDTO, tab: TabKey): boolean {
    return tab === 'recibidas' && this.canonicalEstado(s) === 'pendiente';
  }

  async aceptarRapido(s: SolicitudDTO, ev: Event) {
    ev.stopPropagation();
    if (!this.me) return;

    const libroAceptado = this.getOfertaUnica(s);
    if (!libroAceptado) {
      (await this.toast.create({
        message: 'Error: No se encontró el libro ofrecido.',
        duration: 1500,
        color: 'danger',
      })).present();
      return;
    }

    try {
      await firstValueFrom(
        this.svc.aceptarSolicitud(
          s.id_solicitud,
          this.me.id,
          this.getLibroId(libroAceptado),
        ),
      );
      (await this.toast.create({
        message: 'Solicitud Aceptada',
        duration: 1500,
        color: 'success',
      })).present();
      await this.load();
    } catch (e: any) {
      (await this.toast.create({
        message: e?.error?.detail || 'No se pudo aceptar',
        duration: 1600,
        color: 'danger',
      })).present();
    }
  }

  async rechazarRapido(s: SolicitudDTO, ev: Event) {
    ev.stopPropagation();
    if (!this.me) return;

    const al = await this.alert.create({
      header: '¿Rechazar Solicitud?',
      message: '¿Estás seguro de que quieres rechazar esta solicitud?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Rechazar',
          role: 'destructive',
          handler: async () => {
            try {
              await firstValueFrom(
                this.svc.rechazarSolicitud(s.id_solicitud, this.me!.id),
              );
              (await this.toast.create({
                message: 'Solicitud Rechazada',
                duration: 1500,
                color: 'medium',
              })).present();
              await this.load();
            } catch (e: any) {
              (await this.toast.create({
                message: e?.error?.detail || 'No se pudo rechazar',
                duration: 1600,
                color: 'danger',
              })).present();
            }
          },
        },
      ],
    });
    await al.present();
  }

  trackById(index: number, item: SolicitudDTO): number {
    return item.id_solicitud;
  }
}
