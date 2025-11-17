import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { AuthService, MeUser } from 'src/app/core/services/auth.service';
import { IntercambiosService } from 'src/app/core/services/intercambios.service';
// 👇 AÑADIDO: servicio para imágenes
import { BookImage, BooksService } from 'src/app/core/services/books.service';

// Mapa
import { MapCambiotecasEmbedComponent } from 'src/app/components/map-cambiotecas-embed/map-cambiotecas-embed.component';
import { PlacePicked, PlaceSearchMapComponent } from 'src/app/shared/maps/place-search-map.component';

// --- Tipos ---
type UsuarioLite = { id_usuario: number; nombre_usuario: string | null };
type LibroLite = { id_libro: number; titulo: string; autor?: string | null };
type OfertaLite = { id_oferta: number; libro_ofrecido: LibroLite };
type SolicitudDTO = {
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

type LatLng = { lat: number; lng: number };
type PlaceTab = 'buscar' | 'seguros';
type PropuestaDTO = {
  id: number;
  estado: 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA';
  direccion: string | null;
  fecha: string | null;
  activa: boolean;
} | null;

@Component({
  selector: 'app-request-detail',
  standalone: true,
  imports: [
    CommonModule,
    IonicModule,
    FormsModule,
    MapCambiotecasEmbedComponent,
    PlaceSearchMapComponent
  ],
  templateUrl: './request-detail.page.html',
  styleUrls: ['./request-detail.page.scss'],
})
export class RequestDetailPage implements OnInit {
  me: MeUser | null = null;

  loading = signal(true);
  row = signal<SolicitudDTO | null>(null);

  estado = computed(() => (this.row()?.estado || '').toLowerCase());
  esPendiente = computed(() => this.estado() === 'pendiente');
  esAceptada = computed(() => this.estado() === 'aceptada');

  private liveTimer: any = null;
  private readonly LIVE_MS = 4000;
  private currentId = 0;

  // 👇 Fallback imagen
  readonly FALLBACK = '/assets/librodefecto.png';

  rol = computed<'recibida' | 'enviada'>(() => {
    const r = this.row();
    if (!r || !this.me) return 'enviada';
    return r.receptor?.id_usuario === this.me.id ? 'recibida' : 'enviada';
  });

  // reunión
  lugar = signal('');
  fecha = signal(''); // YYYY-MM-DDTHH:mm
  coords = signal<LatLng | null>(null);

  // código
  codigoGenerado = signal<string | null>(null);
  codigoIngresado = signal('');
  estaCompletado = computed(() => !!this.row()?.fecha_completado);
  puedeCalificar = computed(() => this.estaCompletado());

  // propuesta
  propuesta = signal<PropuestaDTO>(null);

  tienePropuesta = computed(() => {
    const d = this.row();
    return !!(d?.lugar_intercambio && d?.fecha_intercambio_pactada);
  });

  hayPropuestaPendiente = computed(() => {
    const p = this.propuesta();
    return p?.estado === 'PENDIENTE' && p?.activa === true;
  });

  // permisos
  puedeAceptar = computed(() => this.rol() === 'recibida' && this.esPendiente());
  puedeRechazar = computed(() => this.rol() === 'recibida' && this.esPendiente());
  puedeCancelar = computed(() => this.rol() === 'enviada' && this.esPendiente());

  reunionVisible = computed(() => this.esAceptada());
  puedeProponer = computed(() => this.rol() === 'recibida' && this.esAceptada() && !this.tienePropuesta() && !this.hayPropuestaPendiente());
  puedeVerPropuesta = computed(() => this.esAceptada() && (this.tienePropuesta() || this.hayPropuestaPendiente()));
  puedeConfirmarORechazar = computed(() => this.rol() === 'enviada' && this.esAceptada() && this.hayPropuestaPendiente());

  puedeGenerar = computed(() => this.rol() === 'recibida' && this.esAceptada());
  puedeIngresar = computed(() => this.rol() === 'enviada' && this.esAceptada());

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService,
    private svc: IntercambiosService,
    private toast: ToastController,
    private alert: AlertController,
    private booksSvc: BooksService,  // 👈 AÑADIDO
  ) {}

  async ngOnInit() {
    await this.auth.restoreSession();
    this.me = this.auth.user;
    if (!this.me) { this.router.navigateByUrl('/auth/login'); return; }

    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) { this.router.navigateByUrl('/requests'); return; }

    this.currentId = id;
    await this.load(id);
    this.startLive();
  }

  ngOnDestroy(): void { this.stopLive(); }

  async load(id: number) {
    this.loading.set(true);
    try {
      // normalizamos posibles respuestas
      const [recRaw, envRaw] = await Promise.all([
        firstValueFrom(this.svc.listarRecibidas(this.me!.id)),
        firstValueFrom(this.svc.listarEnviadas(this.me!.id)),
      ]) as [unknown, unknown];

      const rec = Array.isArray(recRaw) ? (recRaw as SolicitudDTO[]) : [];
      const env = Array.isArray(envRaw) ? (envRaw as SolicitudDTO[]) : [];
      const all = ([] as SolicitudDTO[]).concat(rec as any[], env as any[]);

      const found = all.find(x => x.id_solicitud === id) ?? null;
      this.row.set(found);

      // 👇 precarga de imágenes con BooksService
      await this.preloadFirstImage(this.miLibroId());
      await this.preloadFirstImage(this.libroOfrecidoId());

      if (found?.intercambio_id) {
        await this.loadPropuestaActual(found.intercambio_id);
      } else {
        this.propuesta.set(null);
      }

      if (found?.lugar_intercambio) this.lugar.set(found.lugar_intercambio);
      if (found?.fecha_intercambio_pactada) {
        const iso = new Date(found.fecha_intercambio_pactada).toISOString().slice(0, 16);
        this.fecha.set(iso);
      }
    } catch (e: any) {
      (await this.toast.create({ message: e?.error?.detail || 'Error cargando solicitud', duration: 1600 })).present();
    } finally {
      this.loading.set(false);
    }
  }

  private async loadPropuestaActual(ixId: number) {
    try {
      const p = await firstValueFrom(this.svc.getPropuestaActual(ixId)) as PropuestaDTO;
      this.propuesta.set((p as any)?.id ? p : null);
    } catch {
      // mantener UI optimista
    }
  }

  private async refreshSilently() {
    if (!this.me || !this.currentId) return;
    try {
      const [recRaw, envRaw] = await Promise.all([
        firstValueFrom(this.svc.listarRecibidas(this.me.id)),
        firstValueFrom(this.svc.listarEnviadas(this.me.id)),
      ]) as [unknown, unknown];

      const rec = Array.isArray(recRaw) ? (recRaw as SolicitudDTO[]) : [];
      const env = Array.isArray(envRaw) ? (envRaw as SolicitudDTO[]) : [];
      const all = ([] as SolicitudDTO[]).concat(rec as any[], env as any[]);

      const found = all.find(x => x.id_solicitud === this.currentId) ?? null;
      this.row.set(found);

      if (found?.intercambio_id) {
        await this.loadPropuestaActual(found.intercambio_id);
      } else {
        this.propuesta.set(null);
      }
    } catch { /* noop */ }
  }

  private startLive() {
    this.stopLive();
    this.liveTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      this.refreshSilently();
    }, this.LIVE_MS);
  }
  private stopLive() { if (this.liveTimer) { clearInterval(this.liveTimer); this.liveTimer = null; } }

  // ===== Oferta única =====
  offeredId(o: any) {
    return o?.libro_ofrecido?.id_libro
      ?? o?.id_libro_ofrecido?.id_libro
      ?? o?.id_libro_ofrecido_id
      ?? o?.id_libro_ofrecido
      ?? null;
  }
  ofertaUnicaId(): number | null {
    const d = this.row();
    if (!d?.ofertas?.length) return null;
    const id = this.offeredId(d.ofertas[0]);
    return id != null ? Number(id) : null;
  }
  ofertaUnicaTitulo(): string {
    const d = this.row();
    const o = d?.ofertas?.[0];
    return (o?.libro_ofrecido?.titulo) || 'Libro';
  }

  colorEstado(est?: string | null) {
    const s = (est || '').toLowerCase();
    if (s === 'pendiente') return 'warning';
    if (s === 'aceptada') return 'primary';
    if (s === 'rechazada' || s === 'cancelada') return 'danger';
    return 'medium';
  }

  // === Acciones ===
  async aceptar() {
    const s = this.row(); if (!s || !this.me) return;
    const libroId = this.ofertaUnicaId();
    if (!libroId) {
      (await this.toast.create({ message: 'Libro inválido', duration: 1200, color: 'danger' })).present();
      return;
    }
    try {
      await firstValueFrom(this.svc.aceptarSolicitud(s.id_solicitud, this.me.id, libroId));
      (await this.toast.create({ message: 'Solicitud aceptada', duration: 1400, color: 'success' })).present();
      await this.load(s.id_solicitud);
    } catch (e: any) {
      (await this.toast.create({ message: e?.error?.detail || 'No se pudo aceptar', duration: 1600, color: 'danger' })).present();
    }
  }

  async rechazar() {
    const s = this.row(); if (!s || !this.me) return;
    const al = await this.alert.create({
      header: 'Rechazar solicitud',
      message: '¿Seguro que deseas rechazarla?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Rechazar', role: 'destructive', handler: async () => {
            try {
              await firstValueFrom(this.svc.rechazarSolicitud(s.id_solicitud, this.me!.id));
              (await this.toast.create({ message: 'Solicitud rechazada', duration: 1400 })).present();
              this.router.navigateByUrl('/requests', { replaceUrl: true });
            } catch (e: any) {
              (await this.toast.create({ message: e?.error?.detail || 'No se pudo rechazar', duration: 1600, color: 'danger' })).present();
            }
          }
        }
      ]
    });
    await al.present();
  }

  async cancelar() {
    const s = this.row(); if (!s || !this.me) return;
    const al = await this.alert.create({
      header: 'Cancelar solicitud',
      message: 'Esto cancelará tu solicitud pendiente.',
      buttons: [
        { text: 'No', role: 'cancel' },
        {
          text: 'Sí, cancelar', role: 'destructive', handler: async () => {
            try {
              await firstValueFrom(this.svc.cancelarSolicitud(s.id_solicitud, this.me!.id));
              (await this.toast.create({ message: 'Solicitud cancelada', duration: 1400 })).present();
              this.router.navigateByUrl('/requests', { replaceUrl: true });
            } catch (e: any) {
              (await this.toast.create({ message: e?.error?.detail || 'No se pudo cancelar', duration: 1600, color: 'danger' })).present();
            }
          }
        }
      ]
    });
    await al.present();
  }

  // Propuesta de reunión (coords + UI optimista)
  async proponer() {
    const s = this.row(); if (!s || !this.me || !s.intercambio_id) return;

    const lugar = (this.lugar() || '').trim();
    const fecha = (this.fecha() || '').trim();
    const coords = this.coords();

    if (!lugar || !fecha) {
      (await this.toast.create({ message: 'Selecciona lugar en mapa y fecha/hora.', duration: 1600, color: 'warning' })).present();
      return;
    }
    if (!coords) {
      (await this.toast.create({ message: 'Debes seleccionar el lugar usando el botón "Mapa".', duration: 1600, color: 'warning' })).present();
      return;
    }

    const al = await this.alert.create({
      header: 'Confirmar propuesta',
      message: `¿Confirmas el encuentro?<br><b>${lugar}</b><br>${new Date(fecha).toLocaleString()}`,
      buttons: [
        { text: 'Volver', role: 'cancel' },
        {
          text: 'Confirmar',
          role: 'confirm',
          handler: async () => {
            try {
              const iso = new Date(fecha).toISOString();

              const resp = await firstValueFrom(
                this.svc.proponerEncuentroManual(
                  s.intercambio_id!, this.me!.id, lugar, iso, coords.lat, coords.lng
                )
              ) as { propuesta_id: number };

              this.propuesta.set({
                id: resp?.propuesta_id ?? 0,
                estado: 'PENDIENTE',
                direccion: lugar,
                fecha: iso,
                activa: true,
              });

              (await this.toast.create({ message: 'Propuesta enviada', duration: 1400 })).present();

              try { await this.loadPropuestaActual(s.intercambio_id!); } catch { /* noop */ }
            } catch (e: any) {
              (await this.toast.create({ message: e?.error?.detail || 'No se pudo proponer', duration: 1600, color: 'danger' })).present();
            }
          }
        }
      ]
    });
    await al.present();
  }

  // Aceptar propuesta (solicitante)
  async confirmar() {
    const s = this.row(); if (!s || !this.me || !s.intercambio_id) return;
    try {
      await firstValueFrom(this.svc.confirmarEncuentro(s.intercambio_id, this.me.id, true));
      (await this.toast.create({ message: 'Propuesta aceptada', duration: 1400, color: 'success' })).present();
      await this.load(s.id_solicitud);
    } catch (e: any) {
      (await this.toast.create({ message: e?.error?.detail || 'No se pudo confirmar', duration: 1600, color: 'danger' })).present();
    }
  }

  // Rechazar propuesta (solicitante)
  async rechazarPropuesta() {
    const s = this.row(); if (!s || !this.me || !s.intercambio_id) return;
    const al = await this.alert.create({
      header: 'Rechazar propuesta',
      message: '¿Deseas rechazar la propuesta de lugar/fecha?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Rechazar', role: 'destructive', handler: async () => {
            try {
              await firstValueFrom(this.svc.confirmarEncuentro(s.intercambio_id!, this.me!.id, false));
              (await this.toast.create({ message: 'Propuesta rechazada', duration: 1400 })).present();
              await this.load(s.id_solicitud);
            } catch (e: any) {
              (await this.toast.create({ message: e?.error?.detail || 'No se pudo rechazar', duration: 1600, color: 'danger' })).present();
            }
          }
        }
      ]
    });
    await al.present();
  }

  // Código
  async generarCodigo() {
    const s = this.row(); if (!s || !this.me || !s.intercambio_id) return;
    try {
      const r = await firstValueFrom(this.svc.generarCodigo(s.intercambio_id, this.me.id)) as { codigo?: string };
      this.codigoGenerado.set(r?.codigo || null);
      (await this.toast.create({ message: 'Código generado', duration: 1300 })).present();
    } catch (e: any) {
      (await this.toast.create({ message: e?.error?.detail || 'No se pudo generar', duration: 1600, color: 'danger' })).present();
    }
  }

  async completar() {
    const row = this.row(); if (!row || !this.me || !row.intercambio_id) return;
    const code = (this.codigoIngresado() || '').trim().toUpperCase();
    if (!code) return;

    try {
      await firstValueFrom(this.svc.completarConCodigo(row.intercambio_id, this.me.id, code));
      (await this.toast.create({ message: '¡Intercambio completado!', duration: 1500, color: 'success' })).present();
      await this.load(row.id_solicitud);
    } catch (e: any) {
      const msg = e?.error?.detail || e?.error?.codigo?.[0] || 'No se pudo completar el intercambio.';
      (await this.toast.create({ message: msg, duration: 1800, color: 'danger' })).present();
    }
  }

  // Calificación
  ratingOpen = signal(false);
  ratingVal = signal(3);
  ratingComment = signal('');
  yaCalifique = signal(false);

  openRating() {
    this.ratingVal.set(3);
    this.ratingComment.set('');
    this.ratingOpen.set(true);
  }
  async confirmRating() {
    const s = this.row(); if (!s || !this.me || !s.intercambio_id) return;
    try {
      await firstValueFrom(this.svc.calificar(s.intercambio_id, this.me.id, this.ratingVal(), this.ratingComment()));
      this.yaCalifique.set(true);
      this.ratingOpen.set(false);
      (await this.toast.create({ message: '¡Gracias por calificar!', duration: 1500, color: 'success' })).present();
    } catch (e: any) {
      const msg = e?.error?.detail || 'No se pudo calificar';
      if ((msg + '').toLowerCase().includes('ya calificaste')) {
        this.yaCalifique.set(true);
        this.ratingOpen.set(false);
      }
      (await this.toast.create({ message: msg, duration: 1700, color: 'danger' })).present();
    }
  }

  // Navegación
  goUser(uid: number | null | undefined) {
    if (!uid) return;
    this.router.navigate(['/users', uid], { state: { from: this.router.url } });
  }
  goChat() {
    const s = this.row();
    if (s?.conversacion_id) this.router.navigate(['/chats', s.conversacion_id]);
  }

  goBook(id?: number | null) {
    if (id) this.router.navigate(['/books', id]);
  }

  onRange(val: any) { this.ratingVal.set(Number(val)); }

  // ==========================================================
  // ===== Helpers títulos / imágenes / modales =====
  // ==========================================================

  miLibroId = (): number | null => {
    const d = this.row();
    if (!d) return null;
    return this.rol() === 'enviada' ? this.ofertaUnicaId() : d.libro_deseado?.id_libro ?? null;
  };

  libroOfrecidoId = (): number | null => {
    const d = this.row();
    if (!d) return null;
    return this.rol() === 'enviada' ? d.libro_deseado?.id_libro ?? null : this.ofertaUnicaId();
  };

  miLibroTitulo = computed(() => {
    const d = this.row();
    if (!d) return '—';
    return this.rol() === 'enviada' ? this.ofertaUnicaTitulo() : d.libro_deseado?.titulo || '—';
  });

  libroOfrecidoTitulo = computed(() => {
    const d = this.row();
    if (!d) return '—';
    return this.rol() === 'enviada' ? d.libro_deseado?.titulo || '—' : this.ofertaUnicaTitulo();
  });

  counterUserId = (): number | null => {
    const d = this.row();
    if (!d) return null;
    return this.rol() === 'enviada' ? d.receptor?.id_usuario : d.solicitante?.id_usuario;
  };

  counterUserName = (): string | null => {
    const d = this.row();
    if (!d) return null;
    return this.rol() === 'enviada' ? (d.receptor?.nombre_usuario ?? null) : (d.solicitante?.nombre_usuario ?? null);
  };

  // ==== IMÁGENES ====
  private imgCache = new Map<number, string | null>();

  private async preloadFirstImage(libroId: number | null) {
    if (!libroId || this.imgCache.has(libroId)) return;
    try {
      const imgs = await firstValueFrom(this.booksSvc.listImages(libroId)) as BookImage[];
      const url = Array.isArray(imgs) && imgs[0]?.url_abs ? String(imgs[0].url_abs) : null;
      this.imgCache.set(libroId, url);
    } catch {
      this.imgCache.set(libroId, null);
    }
  }

  private firstImageOf(id: number | null): string | null {
    if (!id) return null;
    return this.imgCache.get(id) ?? null;
  }

  miLibroImagen(): string {
    return this.firstImageOf(this.miLibroId()) || this.FALLBACK;
  }

  libroOfrecidoImagen(): string {
    return this.firstImageOf(this.libroOfrecidoId()) || this.FALLBACK;
  }

  onImgError(ev: Event) {
    const img = ev.target as HTMLImageElement | null;
    if (!img) return;
    if (img.getAttribute('data-fallback-applied') === '1') return;
    img.setAttribute('data-fallback-applied', '1');
    img.src = this.FALLBACK;
  }

  // --- Fecha/Hora modal ---
  dateTimeModalOpen = signal(false);
  tempFecha = signal('');

  minLocal(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  openDateTimeModal() {
    this.tempFecha.set(this.fecha() || this.minLocal());
    this.dateTimeModalOpen.set(true);
  }

  onTempDateChange(ev: any) {
    const raw = ev?.detail?.value ?? '';
    const v = Array.isArray(raw) ? (raw[0] ?? '') : raw;
    this.tempFecha.set(String(v));
  }

  cancelarFechaModal() {
    this.dateTimeModalOpen.set(false);
  }

  confirmarFechaModal() {
    this.fecha.set(this.tempFecha());
    this.dateTimeModalOpen.set(false);
  }

  // --- Mapa modal ---
  placeOpen = signal(false);
  placeTab = signal<PlaceTab>('seguros');

  openMapPicker() {
    this.placeTab.set('seguros');
    this.placeOpen.set(true);
  }

  onPlaceTabChange(ev: any) {
    const v = (ev?.detail?.value ?? 'buscar') as PlaceTab;
    this.placeTab.set(v);
  }

  onPinPicked(pin: { name: string; address?: string; position: LatLng }) {
    const addr = pin.address || pin.name;
    this.lugar.set(addr || `${pin.position.lat}, ${pin.position.lng}`);
    this.coords.set(pin.position);
    this.placeOpen.set(false);
  }

  onPlacePicked(p: PlacePicked) {
    this.lugar.set(p.address || p.name || `${p.position.lat}, ${p.position.lng}`);
    this.coords.set(p.position);
    this.placeOpen.set(false);
  }

  puedeCancelarIX = computed(() => {
  const s = this.row();
  return this.esAceptada() && !!s?.intercambio_id && !this.estaCompletado();
});

// 👉 acción de cancelar el intercambio
async cancelarIntercambio() {
  const s = this.row(); 
  if (!s || !this.me || !s.intercambio_id) return;

  const al = await this.alert.create({
    header: 'Cancelar intercambio',
    message: 'Esto cancelará el intercambio aceptado y cerrará la coordinación. ¿Deseas continuar?',
    buttons: [
      { text: 'No', role: 'cancel' },
      {
        text: 'Sí, cancelar',
        role: 'destructive',
        handler: async () => {
          try {
            await firstValueFrom(this.svc.cancelarIntercambio(s.intercambio_id!, this.me!.id));
            (await this.toast.create({ message: 'Intercambio cancelado', duration: 1500, color: 'success' })).present();

            // refrescamos el estado: la solicitud queda "Cancelada"
            // puedes recargar todo:
            await this.load(s.id_solicitud);
            // o, si prefieres UI ultra-rápida:
            // this.row.set({ ...s, estado: 'Cancelada' as any });

            // también limpiamos propuesta/código en UI
            this.propuesta.set(null);
            this.codigoGenerado.set(null);
            this.codigoIngresado.set('');
          } catch (e: any) {
            (await this.toast.create({ message: e?.error?.detail || 'No se pudo cancelar', duration: 1700, color: 'danger' })).present();
          }
        }
      }
    ]
  });
  await al.present();
}
}
