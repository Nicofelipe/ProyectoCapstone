// src/app/pages/book-detail/book-detail.page.ts
import { CommonModule, Location } from '@angular/common';
import { Component, computed, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { AuthService } from 'src/app/core/services/auth.service';
import { BookImage, BooksService, MyBookWithHistory } from 'src/app/core/services/books.service';
import { CatalogService, Genero } from 'src/app/core/services/catalog.service';

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
  book = signal<(MyBookWithHistory & any) | null>(null);
  showRequests = signal(false);



  private DB_TO_UI: Record<string, string> = {
    'nuevo': 'Nuevo',
    'como nuevo': 'Como Nuevo',
    'buen estado': 'Usado',
    'con desgaste': 'Gastado',
  };

  // UI -> DB (lo que selecciona el usuario a lo que espera el ENUM)
  private UI_TO_DB: Record<string, string> = {
    'nuevo': 'Nuevo',
    'como nuevo': 'Como nuevo',
    'usado': 'Buen estado',
    'gastado': 'Con desgaste',
  };

  // después
  toUiEstado(raw?: string): string {
    const k = String(raw || '').trim().toLowerCase();
    return this.DB_TO_UI[k] ?? 'Usado';
  }

  private uiToDbEstado(ui?: string): string {
    const k = String(ui || '').trim().toLowerCase();
    return this.UI_TO_DB[k] ?? 'Buen estado';
  }

  readonly ESTADOS = ['Nuevo', 'Como Nuevo', 'Usado', 'Gastado'] as const;
  readonly TAPAS = ['Tapa dura', 'Tapa blanda'] as const;



  private TAPA_MAP: Record<string, string> = {
    'tapada dura': 'Tapa dura',   // typo común
    'tapa blanca': 'Tapa blanda', // typo común
    'tapa dura': 'Tapa dura',
    'tapa blanda': 'Tapa blanda',
  };

  private pickGeneroId(src: any, lista: Genero[]): number | null {
    if (src?.id_genero != null) return Number(src.id_genero);
    const nom = String(src?.genero_nombre || src?.genero || '').trim().toLowerCase();
    if (!nom) return null;
    const hit = lista.find(g => String(g.nombre).trim().toLowerCase() === nom);
    return hit ? Number(hit.id_genero) : null;
  }

  // Para ion-select compareWith
  compareNumber = (a: any, b: any) => Number(a) === Number(b);

  // Galería
  images = signal<BookImage[]>([]);
  galleryOpen = signal(false);
  galleryIndex = signal(0);
  uploading = signal(false);

  // Edición
  editOpen = signal(false);
  edit: any = {};

  // Catálogo
  generos: Genero[] = [];

  // Pre-subida
  pendingFiles = signal<File[]>([]);
  pendingPreviews = signal<string[]>([]);
  pendingCoverIndex = signal(0);
  portadaMode = signal<'keep' | 'new'>('keep');

  currentImage = computed<BookImage | null>(() => {
    const arr = this.images();
    const idx = this.galleryIndex();
    return arr[idx] ?? null;
  });

  counters = computed(() => this.book()?.counters ?? ({
    total: 0, completados: 0, pendientes: 0, aceptados: 0, rechazados: 0,
  }));

  imagesLocked = computed(() => {
    const b = this.book();
    if (!b) return false;
    // si backend manda editable=false, bloquea todo
    if (b.editable === false) return true;
    // fallback por si este endpoint no trae 'editable'
    const hist = b.history || [];
    return hist.some((h: any) => String(h?.estado || '').toLowerCase() === 'completado');
  });



  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService,
    private booksSvc: BooksService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private catalog: CatalogService,
    private location: Location, 
  ) { }

  async ngOnInit() {
    await this.auth.restoreSession();
    const me = this.auth.user;
    if (!me) { this.router.navigateByUrl('/auth/login'); return; }

    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) { this.router.navigateByUrl('/my-books'); return; }

    this.loading.set(true);
    try {
      // 1) “Mis libros con historia” (para history/contadores)
      const all = await firstValueFrom(this.booksSvc.getMineWithHistory(me.id, 20));
      const found = (all || []).find(x => x.id === id);
      if (!found) {
        await this.toast('No se encontró el libro.');
        this.router.navigateByUrl('/my-books');
        return;
      }

      // 2) Detalle completo (isbn, año, id_genero, genero_nombre, etc.)
      const full = await firstValueFrom(this.booksSvc.get(id));

      // 3) Mezcla y set en señal
      const merged = { ...found, ...full };
      this.book.set(merged);

      // 4) Imágenes
      await this.loadImages(id);

      // 5) Catálogo de géneros
      try {
        const lista = await this.catalog.generos();
        this.generos = (lista || []).map(g => ({ ...g, id_genero: Number(g.id_genero) }));
      } catch {
        this.generos = [];
      }
      // 6) Normalizaciones varias…

      const tapaNorm = this.TAPA_MAP[String(merged.tipo_tapa ?? '').toLowerCase()] || merged.tipo_tapa;

      // 🔐 resolver id_genero con fallback por nombre
      const idGenero = this.pickGeneroId(merged, this.generos);

      this.edit = {
        titulo: merged.titulo ?? '',
        autor: merged.autor ?? '',
        editorial: merged.editorial ?? '',
        tipo_tapa: this.TAPAS.includes(tapaNorm as any) ? tapaNorm : 'Tapa blanda',
        estado: this.toUiEstado(merged.estado),
        descripcion: merged.descripcion ?? '',
        disponible: merged.disponible ?? true,
        isbn: merged.isbn ?? '',
        anio_publicacion: typeof merged.anio_publicacion === 'number' ? merged.anio_publicacion : null,
        id_genero: idGenero,                // 👈 ya llega seteado y como number
      };
    } finally {
      this.loading.set(false);
    }
  }

  async ionViewWillEnter() {
    await this.auth.restoreSession();
    const me = this.auth.user;
    const b = this.book();
    if (me && b) {
      try {
        await this.booksSvc.markRequestsSeen(b.id, me.id).toPromise();
        this.book.update(cur => cur ? ({ ...cur, has_new_requests: false } as any) : cur);
        this.booksSvc.emitRequestsSeen(b.id); // notifica a la lista
      } catch { }
    }
  }

  // Helpers UI
  generoName = (id?: number | null) =>
    (this.generos.find(g => g.id_genero === id)?.nombre) || this.book()?.genero_nombre || '—';

  // Solicitudes
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

  // Galería
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
  nextImage() { const len = this.images().length; if (!len) return; this.galleryIndex.set((this.galleryIndex() + 1) % len); }
  prevImage() { const len = this.images().length; if (!len) return; this.galleryIndex.set((this.galleryIndex() - 1 + len) % len); }

  async setAsCover(imagenId?: number) {
    if (!imagenId) return;
    if (this.imagesLocked()) {
      await this.toast('No puedes modificar imágenes: intercambio Completado.');
      return;
    }
    try {
      await this.booksSvc.setCover(imagenId, true).toPromise();
      const after = (this.images() || []).map(i => ({ ...i, is_portada: i.id_imagen === imagenId }));
      this.images.set(after);
      const sel = after.find(x => x.id_imagen === imagenId);
      if (sel) {
        this.book.update(cur => cur ? ({ ...cur, first_image: sel.url_abs } as any) : cur);
        const b = this.book(); if (b) this.booksSvc.emitCoverChanged(b.id, sel.url_abs);
      }
      await this.toast('Portada actualizada');
    } catch (err: any) {
      if (err?.status === 409) return this.toast('No puedes modificar imágenes: intercambio Completado.');
      const msg = err?.error?.detail || 'No se pudo actualizar la portada';
      await this.toast(msg);
    }
  }

  async deleteImage(imagenId?: number) {
    if (!imagenId) return;
    if (this.imagesLocked()) {
      await this.toast('No puedes modificar imágenes: intercambio Completado.');
      return;
    }
    try {
      await this.booksSvc.deleteImage(imagenId).toPromise();
      const newArr = (this.images() || []).filter(i => i.id_imagen !== imagenId);
      this.images.set(newArr);
      if (this.galleryIndex() >= newArr.length) this.galleryIndex.set(Math.max(0, newArr.length - 1));
      if (newArr.length === 0) this.book.update(cur => cur ? ({ ...cur, first_image: null } as any) : cur);
      await this.toast('Imagen eliminada');
    } catch (err: any) {
      if (err?.status === 409) return this.toast('No puedes modificar imágenes: intercambio Completado.');
      const msg = err?.error?.detail || 'No se pudo eliminar la imagen';
      await this.toast(msg);
    }
  }

  onPortadaModeChange(ev: CustomEvent) {
    const val = (ev as any)?.detail?.value as string | undefined;
    this.portadaMode.set(val === 'new' ? 'new' : 'keep');
  }

  // Pre-subida
  onPickFiles(ev: Event) {
    if (this.imagesLocked()) {
      this.toast('No puedes modificar imágenes: intercambio Completado.');
      return;
    }
    const input = ev.target as HTMLInputElement;
    const list = input?.files;
    if (!list || !list.length) return;

    try { this.pendingPreviews().forEach(url => URL.revokeObjectURL(url)); } catch { }

    const files: File[] = []; const previews: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list.item(i)!; if (!f.type.startsWith('image/')) continue;
      files.push(f); previews.push(URL.createObjectURL(f));
    }
    if (!files.length) return;

    this.pendingFiles.set(files);
    this.pendingPreviews.set(previews);
    this.pendingCoverIndex.set(0);
    this.portadaMode.set('keep');
  }

  setPendingCover(i: number) { if (this.portadaMode() === 'new') this.pendingCoverIndex.set(i); }
  clearPending() {
    try { this.pendingPreviews().forEach(url => URL.revokeObjectURL(url)); } catch { }
    this.pendingFiles.set([]); this.pendingPreviews.set([]); this.pendingCoverIndex.set(0); this.portadaMode.set('keep');
  }

  async uploadPending() {
    const b = this.book(); const files = this.pendingFiles();
    if (!b || !files.length) return;

    if (this.imagesLocked()) {
      await this.toast('No puedes modificar imágenes: intercambio Completado.');
      return;
    }

    const current = this.images();
    let maxOrd = 0; for (const im of current) { const o = Number(im.orden ?? 0); if (!Number.isNaN(o)) maxOrd = Math.max(maxOrd, o); }
    const baseOrder = maxOrd + 1;

    const ci = this.pendingCoverIndex();
    const ordered = this.portadaMode() === 'new'
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
          id_imagen: res.id_imagen, url_imagen: res.url_imagen, url_abs: res.url_abs,
          descripcion: '', orden: res.orden, is_portada: !!res.is_portada, created_at: null,
        });
      }

      const merged = [...(this.images() || []), ...newly];
      if (firstShouldBeCover && newly[0]) {
        const newCoverId = newly[0].id_imagen;
        const mergedWithCover = merged.map(i => ({ ...i, is_portada: i.id_imagen === newCoverId }));
        this.images.set(mergedWithCover);
        this.book.update(cur => cur ? ({ ...cur, first_image: newly[0].url_abs } as any) : cur);
      } else { this.images.set(merged); }

      await this.toast(ordered.length === 1 ? 'Imagen subida' : 'Imágenes subidas');
      this.clearPending();
    } catch (err: any) {
      if (err?.status === 409) {
        await this.toast('No puedes modificar imágenes: intercambio Completado.');
      } else {
        const msg = err?.error?.imagen?.[0] || err?.error?.image?.[0] || err?.error?.detail || 'No se pudo subir la(s) imagen(es)';
        console.error(err);
        await this.toast(msg);
      }
    } finally { this.uploading.set(false); }
  }

  editLocked = computed(() => {
    const b = this.book();
    if (!b) return false;
    if (b.editable === false) return true;
    const hist = b.history || [];
    return hist.some((h: any) => String(h?.estado || '').toLowerCase() === 'completado');
  });

  // Edición
  openEdit() {
    if (this.editLocked()) {
      this.toast('No puedes editar: este libro tiene un intercambio Completado.');
      return;
    }
    this.editOpen.set(true);
  }
  closeEdit() { this.editOpen.set(false); }

  async saveEdit() {
    const b = this.book(); if (!b) return;

    if (this.editLocked()) {
      await this.toast('No puedes editar: este libro tiene un intercambio Completado.');
      return;
    }

    const payload: any = {
      titulo: this.edit.titulo,
      autor: this.edit.autor,
      editorial: this.edit.editorial,
      tipo_tapa: this.edit.tipo_tapa,
      estado: this.uiToDbEstado(this.edit.estado),
      descripcion: this.edit.descripcion,
      disponible: this.edit.disponible,
      isbn: this.edit.isbn,
      id_genero: this.edit.id_genero,
    };

    // normaliza año
    if (this.edit.anio_publicacion !== '' && this.edit.anio_publicacion != null) {
      payload.anio_publicacion = Number(this.edit.anio_publicacion);
    }

    // quita undefined
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

    await this.booksSvc.updateBook(b.id, payload).toPromise();

    // Refresca UI local (incluye nombre de género si cambió)
    const genero_nombre = this.generoName(payload.id_genero ?? b['id_genero']);
    this.book.update(cur => cur ? ({ ...cur, ...payload, genero_nombre } as any) : cur);

    await this.toast('Libro actualizado');
    this.editOpen.set(false);
  }

  private async toast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 1800, position: 'bottom' });
    await t.present();
  }

  async deletePublication() {
    const b = this.book(); if (!b) return;
    const alert = await this.alertCtrl.create({
      header: 'Eliminar publicación',
      message: 'Esto eliminará el libro y todas sus imágenes. ¿Continuar?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar', role: 'destructive',
          handler: async () => {
            try {
              await this.booksSvc.deleteBook(b.id).toPromise();
              await this.toast('Publicación eliminada');
              this.router.navigateByUrl('/my-books', { replaceUrl: true });
            } catch (e: any) {
              if (e?.status === 409) {
                // bloqueado por intercambio completado
                return this.toast('No se puede eliminar: este libro participa en un intercambio Completado.');
              }
              const msg = e?.error?.detail || 'No se pudo eliminar';
              await this.toast(msg);
            }
          },
        },
      ],
    });
    await alert.present();
  }

  estadoColor(e?: string): 'success' | 'tertiary' | 'warning' | 'danger' | 'medium' {
    const v = this.toUiEstado(e).toLowerCase();
    if (v === 'nuevo') return 'success';
    if (v === 'como nuevo') return 'tertiary';
    if (v === 'usado') return 'warning';
    if (v === 'gastado') return 'medium';
    return 'medium';
  }

  solicitudIcono(estado?: string): string {
    const v = String(estado || '').toLowerCase();
    if (v === 'completado') return 'checkmark-circle';
    if (v === 'aceptado') return 'checkmark-done-circle';
    if (v === 'rechazado') return 'close-circle';
    if (v === 'cancelado') return 'alert-circle';
    return 'time'; // Pendiente / default
  }

  fallbackHref = '/';

  goBack() {
  if (window.history.length > 1) {
    this.location.back();
  } else {
    this.router.navigateByUrl(this.fallbackHref);
  }
}

  solicitudColor(estado?: string): 'success' | 'primary' | 'warning' | 'danger' | 'medium' {
    const v = String(estado || '').toLowerCase();
    if (v === 'completado') return 'success';
    if (v === 'aceptado') return 'primary';
    if (v === 'rechazado') return 'danger';
    if (v === 'cancelado') return 'medium';
    return 'warning'; // Pendiente
  }
}
