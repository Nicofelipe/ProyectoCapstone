// src/app/pages/books/view/view.page.ts
import { CommonModule, Location } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertController,
  IonAvatar,
  IonBackButton,
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonModal,
  IonNote,
  IonRadio,
  IonRadioGroup,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular/standalone';
import { firstValueFrom } from 'rxjs';

import { FavoritesService } from 'src/app/core/services/favorites.service';
import { AuthService, MeUser } from '../../../core/services/auth.service';
import {
  BookImage,
  BooksService,
  Libro,
  MyBookCard,
  SolicitarGuard,
} from '../../../core/services/books.service';
import { IntercambiosService } from '../../../core/services/intercambios.service';

type OwnerLite = {
  nombre_usuario: string;
  rating_avg: number | null;
  rating_count: number;
};

@Component({
  selector: 'app-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
    IonAvatar,
    IonModal,
    IonNote,
    IonSpinner,
    IonIcon,
    IonFab,
    IonFabButton,
    IonChip,
    IonRadioGroup,
    IonRadio,
    IonRefresher,
    IonRefresherContent,
  ],
  templateUrl: './view.page.html',
  styleUrls: ['./view.page.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})



export class ViewPage implements OnInit {
  // ===== Estado principal =====
  book: Libro | null = null;
  images: BookImage[] = [];
  imgUrls: string[] = [];
  currentIndex = 0;

  owner: OwnerLite | null = null;
  me: MeUser | null = null;

  myBooks: MyBookCard[] = [];
  myAvailBooks: MyBookCard[] = []; // solo libros realmente ofrecibles
  currentMyBook: MyBookCard | null = null;

  // IDs de mis libros ofrecidos ya ocupados en otras solicitudes PENDIENTES
  private occupiedIds = new Set<number>();

  // Guard de negocio para "puedo solicitar este libro?"
  guard: SolicitarGuard | null = null;




  fallbackHref = '/';
  isFav = false;
  isFavBusy = false;
  private favReqSeq = 0;

  imageViewerOpen = false;

  // Modal selección (solo 1 libro)
  offerOpen = false;
  selectedId: number | null = null;
  sending = false;

  // Ya tengo solicitud PENDIENTE/ACEPTADA para este libro (como solicitante)
  alreadySent = false;

  // Solicitud entrante sobre ESTE libro (cuando es mío)
  incoming: any | null = null;
  incomingUserName = '';
  incomingOfferedTitle = '';

  incomingIsForMyBook = false;
  incomingIsForOtherBook = false;

  incomingMyBookTitle = '';

  readonly FALLBACK = '/assets/librodefecto.png';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private booksSvc: BooksService,
    private auth: AuthService,
    private interSvc: IntercambiosService,
    private alert: AlertController,
    private toast: ToastController,
    private location: Location,
    private favs: FavoritesService,
  ) { }

  // ===== Ciclo de vida =====
  async ngOnInit() {
    await this.auth.restoreSession();
    this.me = this.auth.user;

    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) {
      await this.load(id);
    }

    // Estado inicial de favoritos
    if (this.me && id) {
      const seq = ++this.favReqSeq;
      this.isFavBusy = true;

      this.favs.check(id, this.me.id).subscribe({
        next: (v) => {
          if (seq === this.favReqSeq) this.isFav = !!v;
        },
        error: () => {
          if (seq === this.favReqSeq) this.isFav = false;
        },
        complete: () => {
          if (seq === this.favReqSeq) this.isFavBusy = false;
        },
      });
    }
  }

  // ===== Pull-to-refresh =====
  async doRefresh(ev: any) {
    try {
      const currentId = this.book?.id ?? Number(this.route.snapshot.paramMap.get('id'));
      if (currentId) {
        await this.load(currentId);
      }
    } finally {
      ev.target.complete();
    }
  }

  // ===== Favoritos =====
  async toggleFav() {
    if (!this.me || !this.book || this.isMine() || this.isFavBusy) return;

    if (!this.book.disponible) {
      (await this.toast.create({
        message: 'Este libro no está disponible.',
        duration: 1600,
        color: 'medium',
      })).present();
      return;
    }

    const prev = this.isFav;
    this.isFavBusy = true;
    this.isFav = !prev;

    const seq = ++this.favReqSeq;

    this.favs.toggle(this.book.id!, this.me.id).subscribe({
      next: () => { },
      error: () => {
        if (seq === this.favReqSeq) this.isFav = prev;
      },
      complete: () => {
        if (seq === this.favReqSeq) this.isFavBusy = false;
      },
    });
  }

  private normalizeEstado(raw: string): string {
    return (raw ?? '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z]/g, '')
      .trim();
  }

  get incomingEstadoCanon(): string {
    if (!this.incoming) return '';
    return this.normalizeEstado(
      String(this.incoming?.estado_slug ?? this.incoming?.estado ?? ''),
    );
  }

  // ===== Carga principal =====
    private async load(id: number) {
    this.booksSvc.get(id).subscribe({
      next: async (b: Libro) => {
        this.book = b;

        // Owner (ligero)
        if (b.owner_id) {
          try {
            const p = await this.auth.getUserProfile(b.owner_id);
            this.owner = {
              nombre_usuario: p.nombre_completo ?? p.nombre_usuario,
              rating_avg: p.rating_avg ?? null,
              rating_count: p.rating_count ?? 0,
            };
          } catch {
            this.owner = {
              nombre_usuario: b.owner_nombre || '—',
              rating_avg: null,
              rating_count: 0,
            };
          }
        } else if (b.owner_nombre) {
          this.owner = { nombre_usuario: b.owner_nombre, rating_avg: null, rating_count: 0 };
        } else {
          this.owner = null;
        }

        // Imágenes
        this.booksSvc.listImages(id).subscribe({
          next: (imgs: BookImage[]) => {
            this.images = imgs || [];
            const urls = (this.images || [])
              .map((im) => im?.url_abs || '')
              .filter(Boolean);
            this.imgUrls = urls.length ? urls : [this.FALLBACK];
            this.currentIndex = 0;
          },
          error: () => {
            this.images = [];
            this.imgUrls = [this.FALLBACK];
            this.currentIndex = 0;
          },
        });

        // Si estoy logueado: cargar mis libros, ocupados, guard y solicitudes
        if (this.me) {
          const mine = await firstValueFrom(this.booksSvc.getMine(this.me.id));
          this.myBooks = mine || [];
          this.currentMyBook = this.myBooks.find((mb) => mb.id === id) || null;

          // Primero cargar IDs ocupados
          await this.loadOccupiedIds(this.me.id);

          // Construir lista de libros realmente ofrecibles
          this.myAvailBooks = this.myBooks.filter((mb) => this.isBookOfferable(mb, id));

          // ¿Ya envié yo una solicitud para ESTE libro (como solicitante)?
          try {
            this.alreadySent = await firstValueFrom(
              this.interSvc.yaSoliciteEsteLibro(this.me.id, id),
            );
          } catch {
            this.alreadySent = false;
          }

          // Guard de negocio (solo si el libro no es mío)
          if (!this.isMine()) {
            this.guard = this.booksSvc.canSolicitar(
              b,
              this.me.id,
              Array.from(this.occupiedIds),
              this.alreadySent,
            );
          } else {
            this.guard = null;
          }

          // 💡 SIEMPRE: ver si hay solicitudes RECIBIDAS que incluyan ESTE libro conmigo
          await this.loadIncomingForThisBook(id);
        } else {
          this.guard = null;
          this.currentMyBook = null;
          this.myBooks = [];
          this.myAvailBooks = [];
          this.incoming = null;
          this.incomingUserName = '';
          this.incomingOfferedTitle = '';
          this.incomingIsForMyBook = false;
          this.incomingIsForOtherBook = false;
        }
      },
      error: () => {
        this.book = null;
        this.images = [];
        this.imgUrls = [this.FALLBACK];
        this.owner = null;
        this.guard = null;
        this.currentMyBook = null;
        this.incoming = null;
        this.incomingUserName = '';
        this.incomingOfferedTitle = '';
        this.incomingIsForMyBook = false;
        this.incomingIsForOtherBook = false;
      },
    });
  }


  private async loadOccupiedIds(userId: number) {
    try {
      const ids = await firstValueFrom(this.interSvc.librosOfrecidosOcupados(userId));
      this.occupiedIds = new Set(ids || []);
    } catch {
      try {
        const ids = await firstValueFrom(this.interSvc.librosOcupadosDesdeEnviadas(userId));
        this.occupiedIds = new Set(ids || []);
      } catch {
        this.occupiedIds = new Set();
      }
    }
  }

  // Decide si un libro puede aparecer en el modal de oferta
  private isBookOfferable(m: MyBookCard, currentBookId: number): boolean {
    if (m.id === currentBookId) return false;     // no ofrecer el mismo libro
    if (!m.disponible) return false;             // debe estar disponible
    if (this.occupiedIds.has(m.id)) return false; // no puede estar ocupado

    const estado = (m.intercambio_estado || '').toLowerCase();
    if (estado === 'pendiente' || estado === 'aceptado') return false;

    if (m.en_negociacion) return false;

    if (m.status_reason && m.status_reason !== 'OWNER') return false;

    return true;
  }

  // ===== Solicitud entrante para ESTE libro (cuando es mío) =====
  private async loadIncomingForThisBook(bookId: number) {
    if (!this.me) {
      this.incoming = null;
      this.incomingUserName = '';
      this.incomingOfferedTitle = '';
      this.incomingIsForMyBook = false;
      this.incomingIsForOtherBook = false;
      this.incomingMyBookTitle = '';
      return;
    }

    // reset
    this.incoming = null;
    this.incomingUserName = '';
    this.incomingOfferedTitle = '';
    this.incomingIsForMyBook = false;
    this.incomingIsForOtherBook = false;
    this.incomingMyBookTitle = '';

    const currentId = this.book?.id ?? bookId;
    const currentTitle = String(this.book?.titulo ?? '').trim().toLowerCase();

    try {
      const rows = (await firstValueFrom(
        this.interSvc.listarRecibidas(this.me.id),
      )) as any[];

      if (!rows || !rows.length || !currentId) {
        return;
      }

      let match: any | null = null;
      let where: 'desired' | 'offered' | null = null;

      for (const r of rows) {
        const estadoCanon = this.normalizeEstado(
          String(r?.estado_slug ?? r?.estado ?? ''),
        );
        // Solo pendientes o aceptadas
        if (estadoCanon !== 'pendiente' && estadoCanon !== 'aceptada') {
          continue;
        }

        // ===== Lado "mi libro" (libro deseado) =====
        const desiredIdRaw =
          r?.libro_deseado?.id_libro ??
          r?.libro_deseado?.id ??
          r?.libro_deseado_id ??
          r?.id_libro_deseado_id ??
          r?.libro_mio_id ??
          r?.id_libro_mio ??
          null;

        const desiredId =
          desiredIdRaw != null && !Number.isNaN(Number(desiredIdRaw))
            ? Number(desiredIdRaw)
            : NaN;

        const desiredTitle = String(
          r?.libro_mio ??
          r?.libro_mio_titulo ??
          r?.libro_deseado?.titulo ??
          '',
        )
          .trim()
          .toLowerCase();

        // ===== Lado "libro del otro" (ofrecido) =====
        let offeredId: number | null = null;
        let offeredTitle = String(
          r?.libro_del_otro ??
          r?.libro_del_otro_titulo ??
          r?.libro_ofrecido_titulo ??
          '',
        )
          .trim()
          .toLowerCase();

        const ofr0 = (r?.ofertas || [])[0] ?? null;

        if (ofr0) {
          const offeredIdRaw =
            ofr0?.id_libro_ofrecido?.id_libro ??
            ofr0?.id_libro_ofrecido_id ??
            ofr0?.libro_ofrecido?.id_libro ??
            ofr0?.libro_ofrecido_id ??
            ofr0?.id_libro ??
            null;

          if (offeredIdRaw != null && !Number.isNaN(Number(offeredIdRaw))) {
            offeredId = Number(offeredIdRaw);
          }

          offeredTitle = String(
            ofr0?.libro_ofrecido?.titulo ??
            ofr0?.titulo_libro_ofrecido ??
            offeredTitle,
          )
            .trim()
            .toLowerCase();
        }

        const isDesired =
          (!Number.isNaN(desiredId) && desiredId === currentId) ||
          (!!desiredTitle && desiredTitle === currentTitle);

        const isOffered =
          (offeredId != null && offeredId === currentId) ||
          (!!offeredTitle && offeredTitle === currentTitle);

        if (isDesired || isOffered) {
          match = r;
          where = isDesired ? 'desired' : 'offered';
          break;
        }
      }

      if (!match || !where) return;

      this.incoming = match;
      this.incomingIsForMyBook = where === 'desired';
      this.incomingIsForOtherBook = where === 'offered';

      // Datos para la UI
      this.incomingUserName =
        match?.solicitante_nombre ??
        match?.solicitante?.nombre_usuario ??
        match?.solicitante ??
        'Un usuario';

      const ofr0 = (match?.ofertas || [])[0] ?? null;

      this.incomingOfferedTitle =
        ofr0?.libro_ofrecido?.titulo ??
        ofr0?.titulo_libro_ofrecido ??
        match?.libro_del_otro ??
        match?.libro_ofrecido_titulo ??
        this.book?.titulo ??
        '';

      this.incomingMyBookTitle =
        match?.libro_mio ??
        match?.libro_mio_titulo ??
        match?.libro_deseado?.titulo ??
        this.book?.titulo ??
        '';
    } catch {
      this.incoming = null;
      this.incomingUserName = '';
      this.incomingOfferedTitle = '';
      this.incomingMyBookTitle = '';
      this.incomingIsForMyBook = false;
      this.incomingIsForOtherBook = false;
    }
  }

  // Helpers para IDs de solicitud/libro ofrecido
  private getSolicitudId(row: any): number | null {
    const raw =
      row?.id_solicitud ??
      row?.id ??
      row?.solicitud_id ??
      row?.solicitud?.id ??
      row?.pk ??
      null;
    const n = Number(raw);
    return !raw || Number.isNaN(n) ? null : n;
  }

  private getLibroOfrecidoId(row: any): number | null {
    const ofr = row?.ofertas?.[0] ?? null;
    const raw =
      ofr?.id_libro_ofrecido?.id_libro ??
      ofr?.id_libro_ofrecido_id ??
      ofr?.libro_ofrecido?.id_libro ??
      ofr?.libro_ofrecido_id ??
      null;
    const n = Number(raw);
    return !raw || Number.isNaN(n) ? null : n;
  }

  // ===== Navegación / UI helpers =====
  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigateByUrl(this.fallbackHref);
    }
  }

  goOwner(uid?: number | null) {
    if (!uid) return;
    if (this.isMine()) {
      this.router.navigateByUrl('/profile');
    } else {
      this.router.navigate(['/users', uid], { state: { from: this.router.url } });
    }
  }

  isMine(): boolean {
    return !!(this.me && this.book?.owner_id && this.me.id === this.book.owner_id);
  }

  isOccupied(id: number): boolean {
    return this.occupiedIds.has(id);
  }

  hasOfferableBooks(): boolean {
    return this.myAvailBooks.length > 0;
  }

  goLogin() {
    this.router.navigateByUrl('/auth/login');
  }

  goRequests() {
    this.router.navigateByUrl('/requests');
  }

  // Carrusel
  trackByIndex = (i: number) => i;

  onImgError(ev: Event) {
    const img = ev.target as HTMLImageElement | null;
    if (!img) return;
    if (img.getAttribute('data-fallback-applied') === '1') return;
    img.setAttribute('data-fallback-applied', '1');
    img.src = this.FALLBACK;
  }

  onScroll(el: HTMLElement) {
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    this.currentIndex = Math.max(0, Math.min(idx, this.imgUrls.length - 1));
  }

  scrollTo(i: number, el: HTMLElement) {
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
    this.currentIndex = i;
  }

  trackByBookId = (_: number, m: MyBookCard) => m.id;

  // ===== Modal selección (1 libro) =====
  openOffer() {
    this.selectedId = null;
    this.offerOpen = true;
  }

  openImageViewer(startIndex: number) {
    // Abre el modal de visor y deja seleccionado el índice actual
    this.imageViewerOpen = true;
    this.currentIndex = startIndex;

    // Pequeño delay para que el modal monte el DOM y luego scrollear
    setTimeout(() => {
      const el = document.querySelector(
        '.image-viewer-modal .viewer-gallery',
      ) as HTMLElement | null;

      if (el) {
        el.scrollTo({
          left: startIndex * el.clientWidth,
          behavior: 'instant' as ScrollBehavior, // algunos navegadores aceptan 'auto' si te da problema
        });
      }
    }, 0);
  }

  closeImageViewer() {
    this.imageViewerOpen = false;
  }
  closeOffer() {
    this.offerOpen = false;
  }

  async sendOffer() {
    if (!this.me || !this.book) return;
    if (!this.selectedId) return;

    const chosen = this.myAvailBooks.find((b) => b.id === this.selectedId) || null;

    // Seguridad extra: por si cambió algo en backend
    if (!chosen || !chosen.disponible || this.isOccupied(this.selectedId)) {
      (await this.toast.create({
        message: 'El libro seleccionado no está disponible para intercambio.',
        duration: 1800,
        color: 'warning',
      })).present();
      return;
    }

    this.sending = true;
    try {
      await firstValueFrom(
        this.interSvc.crearSolicitud({
          id_usuario_solicitante: this.me.id,
          id_libro_deseado: this.book.id,
          id_libros_ofrecidos: [this.selectedId],
        }),
      );

      (await this.toast.create({
        message: 'Solicitud enviada ✅',
        duration: 1600,
        color: 'success',
      })).present();

      this.alreadySent = true;
      this.offerOpen = false;

      if (this.book) {
        this.guard = this.booksSvc.canSolicitar(
          this.book,
          this.me.id,
          Array.from(this.occupiedIds),
          this.alreadySent,
        );
      }
    } catch (e: any) {
      const msg = e?.error?.detail || 'No se pudo enviar la solicitud';
      (await this.toast.create({
        message: msg,
        duration: 2000,
        color: 'danger',
      })).present();
    } finally {
      this.sending = false;
    }
  }

  // ===== Aceptar / Rechazar rápido solicitud entrante =====
  async quickAccept() {
    if (!this.me || !this.book || !this.incoming) {
      this.goRequests();
      return;
    }

    const solicitudId = this.getSolicitudId(this.incoming);
    const libroOfrecidoId = this.getLibroOfrecidoId(this.incoming);

    if (!solicitudId || !libroOfrecidoId) {
      this.goRequests();
      return;
    }

    const alert = await this.alert.create({
      header: 'Aceptar intercambio',
      message: '¿Quieres aceptar esta oferta ahora?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Aceptar',
          handler: async () => {
            try {
              await firstValueFrom(
                this.interSvc.aceptarSolicitud(solicitudId, this.me!.id, libroOfrecidoId),
              );
              (await this.toast.create({
                message: 'Solicitud aceptada ✅',
                duration: 1800,
                color: 'success',
              })).present();
              this.incoming = null;
              await this.load(this.book!.id);
            } catch (e: any) {
              const msg = e?.error?.detail || 'No se pudo aceptar la solicitud';
              (await this.toast.create({
                message: msg,
                duration: 2000,
                color: 'danger',
              })).present();
            }
          },
        },
      ],
    });

    await alert.present();
  }

  async quickReject() {
    if (!this.me || !this.book || !this.incoming) {
      this.goRequests();
      return;
    }

    const solicitudId = this.getSolicitudId(this.incoming);
    if (!solicitudId) {
      this.goRequests();
      return;
    }

    const alert = await this.alert.create({
      header: 'Rechazar solicitud',
      message: '¿Quieres rechazar esta solicitud?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Rechazar',
          role: 'destructive',
          handler: async () => {
            try {
              await firstValueFrom(this.interSvc.rechazarSolicitud(solicitudId, this.me!.id));
              (await this.toast.create({
                message: 'Solicitud rechazada ❌',
                duration: 1800,
                color: 'medium',
              })).present();
              this.incoming = null;
              await this.load(this.book!.id);
            } catch (e: any) {
              const msg = e?.error?.detail || 'No se pudo rechazar la solicitud';
              (await this.toast.create({
                message: msg,
                duration: 2000,
                color: 'danger',
              })).present();
            }
          },
        },
      ],
    });

    await alert.present();
  }
}
