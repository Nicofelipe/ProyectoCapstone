// src/app/pages/book-detail/book-detail.page.ts
import { CommonModule } from '@angular/common';
import { Component, computed, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { AuthService } from 'src/app/core/services/auth.service';
import { BookImage, BooksService, MyBookWithHistory } from 'src/app/core/services/books.service';

const PLACEHOLDER = '/assets/librodefecto.png';

@Component({
  selector: 'app-my-book-detail',
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  templateUrl: './book-detail.page.html',
  styleUrls: ['./book-detail.page.scss'],
})
export class MyBookDetailPage implements OnInit {
  loading = signal(true);
  book = signal<MyBookWithHistory | null>(null);
  showRequests = signal(false);

  // Galería (ya subidas)
  images = signal<BookImage[]>([]);
  galleryOpen = signal(false);
  galleryIndex = signal(0);
  uploading = signal(false);

  // Edición
  editOpen = signal(false);
  edit: any = {};

  // PRE-SUBIDA (batch como en AddBook)
  pendingFiles = signal<File[]>([]);
  pendingPreviews = signal<string[]>([]);
  pendingCoverIndex = signal(0);
  portadaMode = signal<'keep' | 'new'>('keep'); // mantener portada actual (default) o usar una nueva

  // Imagen actual en la galería
  currentImage = computed<BookImage | null>(() => {
    const arr = this.images();
    const idx = this.galleryIndex();
    return arr[idx] ?? null;
  });

  counters = computed(() => this.book()?.counters ?? {
    total: 0, completados: 0, pendientes: 0, aceptados: 0, rechazados: 0,
  });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService,
    private booksSvc: BooksService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
  ) { }

  async ngOnInit() {
    await this.auth.restoreSession();
    const me = this.auth.user;
    if (!me) { this.router.navigateByUrl('/auth/login'); return; }

    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) { this.router.navigateByUrl('/my-books'); return; }

    this.loading.set(true);
    try {
      const all = await this.booksSvc.getMineWithHistory(me.id, 20).toPromise();
      const found = (all || []).find(x => x.id === id) || null;
      if (!found) {
        await this.toast('No se encontró el libro.');
        this.router.navigateByUrl('/my-books');
        return;
      }
      this.book.set(found);

      await this.loadImages(found.id);
      this.edit = {
        titulo: found.titulo,
        autor: found.autor,
        editorial: found.editorial,
        genero: found.genero,
        tipo_tapa: found.tipo_tapa,
        estado: found.estado,
        descripcion: found.descripcion,
        isbn: (found as any).isbn,
        anio_publicacion: (found as any).anio_publicacion,
        disponible: found.disponible,
      };
    } finally {
      this.loading.set(false);
    }
  }

  // === Solicitudes ===
  toggleRequests() {
    const open = !this.showRequests();
    this.showRequests.set(open);
    if (open) {
      const me = this.auth.user!;
      const b = this.book();
      if (me && b) {
        this.booksSvc.markRequestsSeen(b.id, me.id).toPromise()
          .then(() => this.book.update(cur => cur ? ({ ...cur, has_new_requests: false } as any) : cur))
          .catch(() => { });
      }
    }
  }

  trackByHistory = (_: number, h: { id: number }) => h?.id;

  onImgError(ev: Event) {
    const img = ev.target as HTMLImageElement;
    if (img && !img.src.includes(PLACEHOLDER)) img.src = PLACEHOLDER;
  }

  // === Galería (ya subidas) ===
  async loadImages(libroId: number) {
    const imgs = await this.booksSvc.listImages(libroId).toPromise();
    this.images.set(imgs ?? []);
  }

  openGallery(startAt = 0) {
    const lastIdx = Math.max(0, (this.images().length || 1) - 1);
    this.galleryIndex.set(Math.min(Math.max(0, startAt), lastIdx));
    this.galleryOpen.set(true);
  }
  closeGallery() { this.galleryOpen.set(false); }

  nextImage() {
    const len = this.images().length;
    if (!len) return;
    this.galleryIndex.set((this.galleryIndex() + 1) % len);
  }
  prevImage() {
    const len = this.images().length;
    if (!len) return;
    this.galleryIndex.set((this.galleryIndex() - 1 + len) % len);
  }

  async setAsCover(imagenId?: number) {
    if (!imagenId) return;
    await this.booksSvc.setCover(imagenId, true).toPromise();

    // marca portada en la UI local
    const after = (this.images() || []).map(i => ({ ...i, is_portada: i.id_imagen === imagenId }));
    this.images.set(after);

    // actualiza la imagen de cabecera del detalle
    const sel = after.find(x => x.id_imagen === imagenId);
    if (sel) {
      this.book.update(cur => cur ? ({ ...cur, first_image: sel.url_abs } as any) : cur);

      // 👇 avisa a MyBooks para que cambie al instante
      const b = this.book();
      if (b) this.booksSvc.emitCoverChanged(b.id, sel.url_abs);
    }

    await this.toast('Portada actualizada');
  }

  async deleteImage(imagenId?: number) {
    if (!imagenId) return;
    await this.booksSvc.deleteImage(imagenId).toPromise();
    const newArr = (this.images() || []).filter(i => i.id_imagen !== imagenId);
    this.images.set(newArr);
    if (this.galleryIndex() >= newArr.length) {
      this.galleryIndex.set(Math.max(0, newArr.length - 1));
    }
    if (newArr.length === 0) {
      this.book.update(cur => cur ? ({ ...cur, first_image: null } as any) : cur);
    }
    await this.toast('Imagen eliminada');
  }

  // Manejo del ion-segment (evita "as any" en la plantilla)
  onPortadaModeChange(ev: CustomEvent) {
    const val = (ev as any)?.detail?.value as string | undefined;
    if (val === 'keep' || val === 'new') this.portadaMode.set(val);
    else this.portadaMode.set('keep');
  }

  // =========================
  // PRE-SUBIDA (batch con opción mantener portada)
  // =========================
  onPickFiles(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const list = input?.files;
    if (!list || !list.length) return;

    try { this.pendingPreviews().forEach(url => URL.revokeObjectURL(url)); } catch { }

    const files: File[] = [];
    const previews: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list.item(i)!;
      if (!f.type.startsWith('image/')) continue;
      files.push(f);
      previews.push(URL.createObjectURL(f));
    }
    if (!files.length) return;

    this.pendingFiles.set(files);
    this.pendingPreviews.set(previews);
    this.pendingCoverIndex.set(0);
    this.portadaMode.set('keep');
  }

  setPendingCover(i: number) {
    if (this.portadaMode() === 'new') this.pendingCoverIndex.set(i);
  }

  clearPending() {
    try { this.pendingPreviews().forEach(url => URL.revokeObjectURL(url)); } catch { }
    this.pendingFiles.set([]);
    this.pendingPreviews.set([]);
    this.pendingCoverIndex.set(0);
    this.portadaMode.set('keep');
  }

  async uploadPending() {
    const b = this.book();
    const files = this.pendingFiles();
    if (!b || !files.length) return;

    // orden base (continúa el mayor existente)
    const current = this.images();
    let maxOrd = 0;
    for (const im of current) {
      const o = Number(im.orden ?? 0);
      if (!Number.isNaN(o)) maxOrd = Math.max(maxOrd, o);
    }
    const baseOrder = maxOrd + 1;

    // si el usuario eligió nueva portada, esa va primero
    const ci = this.pendingCoverIndex();
    const ordered: File[] =
      this.portadaMode() === 'new'
        ? [files[ci], ...files.filter((_, idx) => idx !== ci)]
        : [...files];

    const hasExisting = (current?.length || 0) > 0;
    const firstShouldBeCover = this.portadaMode() === 'new' || !hasExisting;

    this.uploading.set(true);
    try {
      const newly: BookImage[] = [];
      for (let j = 0; j < ordered.length; j++) {
        const file = ordered[j];
        const res: any = await this.booksSvc
          .uploadImage(b.id, file, { is_portada: firstShouldBeCover && j === 0, orden: baseOrder + j })
          .toPromise();
        newly.push({
          id_imagen: res.id_imagen,
          url_imagen: res.url_imagen,
          url_abs: res.url_abs,
          descripcion: '',
          orden: res.orden,
          is_portada: !!res.is_portada,
          created_at: null,
        });
      }

      const merged = [...(this.images() || []), ...newly];

      if (firstShouldBeCover && newly[0]) {
        const newCoverId = newly[0].id_imagen;
        const mergedWithCover = merged.map(i => ({ ...i, is_portada: i.id_imagen === newCoverId }));
        this.images.set(mergedWithCover);
        this.book.update(cur => cur ? ({ ...cur, first_image: newly[0].url_abs } as any) : cur);
      } else {
        this.images.set(merged);
      }

      await this.toast(ordered.length === 1 ? 'Imagen subida' : 'Imágenes subidas');
      this.clearPending();
    } catch (err: any) {
      const msg =
        err?.error?.imagen?.[0] ||
        err?.error?.image?.[0] ||
        err?.error?.detail ||
        'No se pudo subir la(s) imagen(es)';
      console.error(err);
      await this.toast(msg);
    } finally {
      this.uploading.set(false);
    }
  }

  // === Edición ===
  openEdit() { this.editOpen.set(true); }
  closeEdit() { this.editOpen.set(false); }

  async saveEdit() {
    const b = this.book();
    if (!b) return;
    const payload: any = { ...this.edit };
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

    await this.booksSvc.updateBook(b.id, payload).toPromise();
    this.book.update(cur => cur ? ({ ...cur, ...payload } as any) : cur);
    await this.toast('Libro actualizado');
    this.editOpen.set(false);
  }

  private async toast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 1800, position: 'bottom' });
    await t.present();
  }

  async deletePublication() {
    const b = this.book();
    if (!b) return;

    const alert = await this.alertCtrl.create({
      header: 'Eliminar publicación',
      message: 'Esto eliminará el libro y todas sus imágenes. ¿Continuar?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: async () => {
            try {
              await this.booksSvc.deleteBook(b.id).toPromise();
              await this.toast('Publicación eliminada');
              this.router.navigateByUrl('/my-books', { replaceUrl: true });
            } catch (e: any) {
              const msg = e?.error?.detail || 'No se pudo eliminar';
              await this.toast(msg);
            }
          },
        },
      ],
    });
    await alert.present();
  }
}
