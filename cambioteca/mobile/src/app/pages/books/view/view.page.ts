import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertController,
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader,
  IonImg, IonItem, IonLabel, IonList, IonMenuButton, IonTitle, IonToolbar,
  ToastController
} from '@ionic/angular/standalone';

import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { BookImage, BooksService, Libro, MyBookCard } from '../../../core/services/books.service';

type OwnerLite = { nombre_usuario: string; rating_avg: number | null; rating_count: number; };

@Component({
  selector: 'app-view',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonBackButton,
    IonList, IonItem, IonLabel, IonButton, IonImg
  ],
  templateUrl: './view.page.html',
  styleUrls: ['./view.page.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ViewPage implements OnInit {
  book: Libro | null = null;
  images: BookImage[] = [];

  /** URLs que muestra el carrusel (con fallback ya resuelto) */
  imgUrls: string[] = [];
  currentIndex = 0;

  owner: OwnerLite | null = null;
  myBooks: MyBookCard[] = [];

  /** Fallback local para evitar 404 del dev server */
  readonly FALLBACK = '/assets/librodefecto.png';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private booksSvc: BooksService,
    private auth: AuthService,
    private alert: AlertController,
    private toast: ToastController,
  ) {}

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) this.load(id);
  }

  private async load(id: number) {
    this.booksSvc.get(id).subscribe({
      next: async (b) => {
        this.book = b;

        // Owner
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
          next: imgs => {
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

        // Mis libros disponibles
        await this.auth.restoreSession();
        const me = this.auth.user;
        if (me) {
          const mine = await firstValueFrom(this.booksSvc.getMine(me.id));
          this.myBooks = (mine || []).filter(mb => mb.disponible && mb.id !== id);
        }
      },
      error: () => { this.book = null; this.images = []; this.imgUrls = [this.FALLBACK]; this.owner = null; }
    });
  }

  // ==== Carrusel helpers ====
  trackByIndex = (i: number) => i;

  onImgError(ev: Event) {
    const img = ev.target as HTMLImageElement | null;
    if (!img) return;
    // Evita bucle si el fallback también falla
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

  // ==== Reglas de UI ====
  isMine(): boolean {
    const me = this.auth.user;
    return !!(me && this.book?.owner_id && me.id === this.book.owner_id);
  }

  canPropose(): boolean {
    const me = this.auth.user;
    if (!me || !this.book) return false;
    if (this.isMine()) return false;
    if (this.book.disponible === false) return false;
    return true;
  }

  async proponerIntercambio() {
    const me = this.auth.user;
    const b = this.book;
    if (!me) { this.router.navigateByUrl('/auth/login'); return; }
    if (!b) return;

    if (!this.myBooks.length) {
      (await this.toast.create({ message: 'No tienes libros disponibles para ofrecer.', duration: 1800, color: 'medium' })).present();
      return;
    }

    const inputs = this.myBooks.slice(0, 10).map(mb => ({
      type: 'radio' as const, label: `${mb.titulo} — ${mb.autor}`, value: mb.id
    }));

    const alert = await this.alert.create({
      header: 'Proponer intercambio',
      message: 'Elige uno de tus libros y confirma.',
      inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Enviar',
          role: 'confirm',
          handler: async (id_libro_ofrecido: number): Promise<boolean> => {
            if (!id_libro_ofrecido) {
              (await this.toast.create({ message: 'Debes elegir un libro.', duration: 1400, color: 'warning' })).present();
              return false;
            }
            try {
              await firstValueFrom(
                this.booksSvc.createIntercambio({
                  id_usuario_solicitante: me.id,
                  id_libro_ofrecido,
                  id_usuario_ofreciente: b.owner_id!,
                  id_libro_solicitado: b.id,
                  lugar_intercambio: 'A coordinar'
                })
              );
              (await this.toast.create({ message: 'Solicitud enviada ✅', duration: 1600, color: 'success' })).present();
              return true;
            } catch (e: any) {
              const msg = e?.error?.detail || 'No se pudo enviar la solicitud';
              (await this.toast.create({ message: msg, duration: 2000, color: 'danger' })).present();
              return false;
            }
          }
        }
      ]
    });
    await alert.present();
  }
}
