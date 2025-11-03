// src/app/pages/books/view/view.page.ts
import { CommonModule, Location } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertController,
  IonAvatar,
  IonBackButton, IonButton, IonButtons,
  IonCheckbox,
  IonContent,
  IonFab, IonFabButton,
  IonHeader,
  IonIcon,
  IonItem, IonLabel, IonList, IonMenuButton,
  IonModal,
  IonNote,
  IonSpinner,
  IonTitle, IonToolbar,
  ToastController
} from '@ionic/angular/standalone';
import { FavoritesService } from 'src/app/core/services/favorites.service';


import { firstValueFrom } from 'rxjs';
import { AuthService, MeUser } from '../../../core/services/auth.service';
import { BookImage, BooksService, Libro, MyBookCard } from '../../../core/services/books.service';
import { IntercambiosService } from '../../../core/services/intercambios.service';

type OwnerLite = { nombre_usuario: string; rating_avg: number | null; rating_count: number; };


@Component({
  selector: 'app-view',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonBackButton,
    IonList, IonItem, IonLabel, IonButton,
    IonAvatar, IonModal, IonCheckbox, IonNote, IonSpinner,
    IonIcon, IonFab, IonFabButton,
  ],
  templateUrl: './view.page.html',
  styleUrls: ['./view.page.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ViewPage implements OnInit {
  book: Libro | null = null;
  images: BookImage[] = [];
  imgUrls: string[] = [];
  currentIndex = 0;

  owner: OwnerLite | null = null;
  me: MeUser | null = null;

  myBooks: MyBookCard[] = [];
  myAvailBooks: MyBookCard[] = [];

  // IDs de mis libros que ya están ofrecidos en otra solicitud PENDIENTE
  private occupiedIds = new Set<number>();

  fallbackHref = '/';
  isFav = false;
  isFavBusy = false;          // 👈 NUEVO
  private favReqSeq = 0;   // <- NUEVA: secuencia para ignorar respuestas viejas    // secuencia para ignorar respuestas viejas

  // modal selección
  offerOpen = false;
  selectedIds: number[] = [];
  sending = false;

  // si ya existe una solicitud PENDIENTE para este libro
  alreadySent = false;

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

  async ngOnInit() {
    await this.auth.restoreSession();
    this.me = this.auth.user;
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) await this.load(id);

    if (this.me && id) {
      const seq = ++this.favReqSeq;
      this.isFavBusy = true;
      this.favs.check(id, this.me.id).subscribe({
        next: v => { if (seq === this.favReqSeq) this.isFav = !!v; },
        error: () => { if (seq === this.favReqSeq) this.isFav = false; },
        complete: () => { if (seq === this.favReqSeq) this.isFavBusy = false; }
      });
    }
  }

  async toggleFav() {
    if (!this.me || !this.book || this.isMine() || this.isFavBusy) return;

    // Si decides mantener 409 en backend, evita el post:
    if (!this.book.disponible) {
      (await this.toast.create({
        message: 'Este libro no está disponible.',
        duration: 1600,
        color: 'medium'
      })).present();
      return;
    }

    const prev = this.isFav;
    this.isFavBusy = true;
    this.isFav = !prev;

    const seq = ++this.favReqSeq;
    this.favs.toggle(this.book.id!, this.me.id).subscribe({
      next: () => { },
      error: () => { if (seq === this.favReqSeq) this.isFav = prev; },
      complete: () => { if (seq === this.favReqSeq) this.isFavBusy = false; }
    });
  }




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
              rating_count: p.rating_count ?? 0
            };
          } catch {
            this.owner = { nombre_usuario: b.owner_nombre || '—', rating_avg: null, rating_count: 0 };
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
              .map(im => im?.url_abs || '')
              .filter(Boolean);
            this.imgUrls = urls.length ? urls : [this.FALLBACK];
            this.currentIndex = 0;
          },
          error: () => {
            this.images = [];
            this.imgUrls = [this.FALLBACK];
            this.currentIndex = 0;
          }
        });

        // Si estoy logueado: cargar mis libros, ocupados y si ya envié solicitud para este
        if (this.me) {
          const mine = await firstValueFrom(this.booksSvc.getMine(this.me.id));
          this.myBooks = mine || [];
          this.myAvailBooks = this.myBooks.filter(mb => mb.disponible && mb.id !== id);

          // Cargar IDs ocupados (endpoint recomendado) con fallback a /enviadas
          await this.loadOccupiedIds(this.me.id);

          // Ya tengo pendiente para ESTE libro
          try {
            this.alreadySent = await firstValueFrom(
              this.interSvc.yaSoliciteEsteLibro(this.me.id, id)
            );
          } catch {
            this.alreadySent = false;
          }
        }
      },
      error: () => {
        this.book = null;
        this.images = [];
        this.imgUrls = [this.FALLBACK];
        this.owner = null;
      }
    });
  }

  trackByBookId = (_: number, m: MyBookCard) => m.id;

  private async loadOccupiedIds(userId: number) {
    try {
      const ids = await firstValueFrom(this.interSvc.librosOfrecidosOcupados(userId));
      this.occupiedIds = new Set(ids || []);
    } catch {
      // Fallback si no implementaste el endpoint
      try {
        const ids = await firstValueFrom(this.interSvc.librosOcupadosDesdeEnviadas(userId));
        this.occupiedIds = new Set(ids || []);
      } catch {
        this.occupiedIds = new Set();
      }
    }
  }

  goBack() {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigateByUrl(this.fallbackHref);
    }
  }

  goOwner(uid?: number | null) {
    if (!uid) return;
    // si el libro es mío, mando a mi perfil; si no, al perfil público
    if (this.isMine()) {
      this.router.navigateByUrl('/profile');
    } else {
      this.router.navigate(['/users', uid], { state: { from: this.router.url } });
    }
  }

  // Carrusel helpers
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

  // Helpers UI
  isMine(): boolean {
    return !!(this.me && this.book?.owner_id && this.me.id === this.book.owner_id);
  }
  isOccupied(id: number): boolean {
    return this.occupiedIds.has(id);
  }

  goLogin() { this.router.navigateByUrl('/auth/login'); }
  goRequests() { this.router.navigateByUrl('/requests'); } // TODO: ajusta cuando tengas la page

  // Modal
  openOffer() {
    this.selectedIds = [];
    this.offerOpen = true;
  }
  closeOffer() { this.offerOpen = false; }

  async toggleSelect(id: number) {
    if (this.isOccupied(id)) {
      (await this.toast.create({
        message: 'Este libro ya pertenece a otra solicitud pendiente. Cancélala para ofrecerlo aquí.',
        duration: 2200,
        color: 'medium'
      })).present();
      return;
    }

    if (this.selectedIds.includes(id)) {
      this.selectedIds = this.selectedIds.filter(x => x !== id);
    } else {
      if (this.selectedIds.length >= 3) {
        (await this.toast.create({
          message: 'Solo puedes elegir hasta 3 libros.',
          duration: 1600,
          color: 'warning'
        })).present();
        return;
      }
      this.selectedIds = [...this.selectedIds, id];
    }
  }

  async sendOffer() {
    if (!this.me || !this.book) return;
    if (!this.selectedIds.length || this.selectedIds.length > 3) return;

    // Seguridad extra: ninguno seleccionado puede estar ocupado
    const invalid = this.selectedIds.find(x => this.isOccupied(x));
    if (invalid) {
      (await this.toast.create({
        message: 'Uno de los libros seleccionados ahora está en otra solicitud.',
        duration: 1800,
        color: 'warning'
      })).present();
      return;
    }

    this.sending = true;
    try {
      await firstValueFrom(this.interSvc.crearSolicitud({
        id_usuario_solicitante: this.me.id,
        id_libro_deseado: this.book.id,
        id_libros_ofrecidos: this.selectedIds,
      }));
      (await this.toast.create({ message: 'Solicitud enviada ✅', duration: 1600, color: 'success' })).present();
      this.alreadySent = true;   // bloquea el botón
      this.offerOpen = false;
    } catch (e: any) {
      const msg = e?.error?.detail || 'No se pudo enviar la solicitud';
      (await this.toast.create({ message: msg, duration: 2000, color: 'danger' })).present();
    } finally {
      this.sending = false;
    }
  }
}
