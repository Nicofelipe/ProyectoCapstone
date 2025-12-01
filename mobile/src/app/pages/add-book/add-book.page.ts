// src/app/pages/add-book/add-book.page.ts
import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators
} from '@angular/forms';
import { Router } from '@angular/router';
import { IonicModule, LoadingController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { BooksService, MyBookCard } from '../../core/services/books.service';
import { CatalogService, Genero } from '../../core/services/catalog.service';

// ===== validator ISBN (acepta 10 o 13 dígitos, ignora guiones/espacios) =====
function isbnValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const raw = String(control.value ?? '');
    const clean = raw.replace(/[^0-9Xx]/g, ''); // acepta X en ISBN-10
    if (!clean) return { required: true };
    if (clean.length !== 10 && clean.length !== 13) return { isbnLength: true };
    return null;
  };
}

@Component({
  selector: 'app-add-book',
  standalone: true,
  imports: [CommonModule, IonicModule, ReactiveFormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './add-book.page.html',
  styleUrls: ['./add-book.page.scss'],
})
export class AddBookPage {
  form: FormGroup;
  estados = ['Nuevo', 'Como nuevo', 'Buen estado', 'Con desgaste'];
  tapas = ['Tapa dura', 'Tapa blanda'];

  files: File[] = [];
  previews: string[] = [];
  coverIndex = 0;
  sending = false;

  currentYear = new Date().getFullYear();

  generos: Genero[] = [];

  constructor(
    private fb: FormBuilder,
    private books: BooksService,
    private auth: AuthService,
    private router: Router,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private catalog: CatalogService,
  ) {
    const currentYear = this.currentYear;

    this.form = this.fb.group({
      titulo: ['', [Validators.required, Validators.minLength(2)]],
      autor: ['', [Validators.required, Validators.minLength(2)]],
      isbn: ['', [Validators.required, isbnValidator()]],
      anio_publicacion: [
        currentYear,
        [Validators.required, Validators.min(1800), Validators.max(currentYear)],
      ],
      editorial: ['', Validators.required],

      // usamos id_genero en el form
      id_genero: [null, Validators.required],

      tipo_tapa: [this.tapas[1], Validators.required],
      estado: [this.estados[2], Validators.required],
      descripcion: ['', [Validators.required, Validators.minLength(10)]],
    });
  }

  async ngOnInit() {
    try {
      this.generos = await this.catalog.generos();
      if (!this.form.get('id_genero')?.value && this.generos.length) {
        this.form.get('id_genero')?.setValue(this.generos[0].id_genero);
      }
    } catch {
      this.generos = [];
    }
  }

  // ====== imágenes ======
  onSelectFiles(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const list = input.files;
    if (!list || !list.length) return;

    // reset si vuelven a elegir
    this.files.forEach((_, i) => URL.revokeObjectURL(this.previews[i]));
    this.files = [];
    this.previews = [];

    for (let i = 0; i < list.length; i++) {
      const f = list.item(i)!;
      if (!f.type.startsWith('image/')) continue;
      this.files.push(f);
      this.previews.push(URL.createObjectURL(f));
    }
    this.coverIndex = 0;
  }

  setCover(i: number) { this.coverIndex = i; }

  toNumber(ctrlName: string) {
    const v = Number(this.form.get(ctrlName)?.value);
    if (!Number.isNaN(v)) this.form.get(ctrlName)?.setValue(v, { emitEvent: false });
  }

  formInvalidControls() {
    const bad: string[] = [];
    Object.entries(this.form.controls).forEach(([name, ctrl]) => {
      if (ctrl.invalid) bad.push(name);
    });
    return bad;
  }

  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast('Completa los campos obligatorios');
      return;
    }
    const me = this.auth.user;
    if (!me) { this.router.navigateByUrl('/auth/login'); return; }

    const loading = await this.loadingCtrl.create({ message: 'Publicando libro…' });
    await loading.present();
    this.sending = true;

    try {
      const v = this.form.value as any;

      // nombre del género (por si el backend aún espera "genero")
      const generoName = this.generos.find(g => g.id_genero === Number(v.id_genero))?.nombre ?? null;

      // 👉 usa ISO 8601 para máxima compatibilidad con serializers
      const fechaISO = new Date().toISOString();

      const payload = {
        titulo: v.titulo,
        autor: v.autor,
        isbn: v.isbn,
        anio_publicacion: Number(v.anio_publicacion),
        editorial: v.editorial,

        // ambos campos por compatibilidad
        id_genero: Number(v.id_genero),
        ...(generoName ? { genero: generoName } : {}),

        tipo_tapa: v.tipo_tapa,
        estado: v.estado,
        descripcion: v.descripcion,

        id_usuario: me.id,
        disponible: true,

        // 👇 evita el “cannot be null”
        fecha_subida: fechaISO,
      };

      console.log('[ADD-BOOK] payload =>', payload);

      const created: any = await firstValueFrom(this.books.create(payload));
      const libroId = Number(created?.id || created?.id_libro);

      // 2) subir imágenes (portada primero)
      let firstImageUrl: string | undefined;

      if (libroId && this.files.length) {
        const portada = this.files[this.coverIndex];
        const portadaResp: any = await firstValueFrom(
          this.books.uploadImage(libroId, portada, { is_portada: true, orden: 1 })
        );
        firstImageUrl = portadaResp?.url_abs || portadaResp?.url_imagen || undefined;

        const others = this.files.filter((_, idx) => idx !== this.coverIndex);
        let orden = 2;
        for (const f of others) {
          await firstValueFrom(this.books.uploadImage(libroId, f, { is_portada: false, orden }));
          orden++;
        }
      }

      // 3) emitir evento para refrescar “Mis libros”
      const newCard: MyBookCard = {
        id: libroId,
        titulo: v.titulo,
        autor: v.autor,
        estado: v.estado,
        descripcion: v.descripcion,
        editorial: v.editorial,
        genero: generoName || '',
        genero_nombre: generoName ?? null,
        tipo_tapa: v.tipo_tapa,
        disponible: true,
        fecha_subida: fechaISO,
        first_image: firstImageUrl ?? null,
        has_requests: false,
        has_new_requests: false,
        comuna_nombre: null,
      };

      this.books.emitCreated(newCard);

      // (luego sigue tu flujo actual)
      await loading.dismiss();
      this.toast('¡Libro publicado!');
      this.router.navigateByUrl('/my-books', { replaceUrl: true });
    } catch (e: any) {
      await loading.dismiss();
      this.sending = false;

      // muestra el detalle que manda el backend
      console.error('[ADD-BOOK] error:', e);
      const detail =
        e?.error?.detail ??
        e?.error?.message ??
        (typeof e?.error === 'string' ? e.error : null);

      // Si el backend devuelve dict por campo, conviértelo a string legible
      const fieldErrors = e?.error && typeof e.error === 'object'
        ? Object.entries(e.error).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ')
        : null;

      const msg = detail || fieldErrors || 'Error al publicar';
      this.toast(`No se pudo crear: ${msg}`);
    }
  }

  async toast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'bottom' });
    await t.present();
  }

  ionViewWillLeave() {
    this.previews.forEach(url => URL.revokeObjectURL(url));
  }

  async lookupIsbn() {
    const ctrl = this.form.get('isbn');
    if (!ctrl) return;

    ctrl.markAsTouched();
    if (ctrl.invalid) {
      this.toast('Ingresa un ISBN válido (10 o 13 dígitos).');
      return;
    }

    const raw = String(ctrl.value ?? '');
    const clean = raw.replace(/[^0-9Xx]/g, '');
    if (!clean) {
      this.toast('Ingresa un ISBN primero.');
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: 'Buscando datos del libro…',
    });
    await loading.present();

    try {
      const info = await firstValueFrom(this.books.lookupIsbn(clean));
      await loading.dismiss();

      if (!info) {
        this.toast('No se encontraron datos para ese ISBN.');
        return;
      }

      const patch: any = {};

      // Solo rellenamos campos vacíos, para no pisar lo que el usuario ya escribió
      if (!this.form.get('titulo')?.value && info.titulo) {
        patch.titulo = info.titulo;
      }
      if (!this.form.get('autor')?.value && info.autor) {
        patch.autor = info.autor;
      }
      if (!this.form.get('editorial')?.value && info.editorial) {
        patch.editorial = info.editorial;
      }
      if (!this.form.get('anio_publicacion')?.value && info.anio_publicacion) {
        patch.anio_publicacion = info.anio_publicacion;
      }
      if (!this.form.get('descripcion')?.value && info.descripcion) {
        patch.descripcion = info.descripcion;
      }

      // (Opcional) podrías intentar mapear género por título/autor, pero eso ya es “nice to have”

      if (Object.keys(patch).length) {
        this.form.patchValue(patch);
        this.toast('Datos completados desde ISBN. Revísalos antes de publicar.');
      } else {
        this.toast('No había nada nuevo para completar con ese ISBN.');
      }
    } catch (e) {
      await loading.dismiss();
      console.error('[ISBN LOOKUP] error:', e);
      this.toast('No se pudo consultar los datos del ISBN.');
    }
  }
}