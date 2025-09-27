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
import { BooksService } from '../../core/services/books.service';

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

  // para plantilla (validación año)
  currentYear = new Date().getFullYear();

  constructor(
    private fb: FormBuilder,
    private books: BooksService,
    private auth: AuthService,
    private router: Router,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
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
      genero: ['', Validators.required],
      tipo_tapa: [this.tapas[1], Validators.required],
      estado: [this.estados[2], Validators.required],
      descripcion: ['', [Validators.required, Validators.minLength(10)]],
    });
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

  // normaliza valores numéricos (ion-input suele emitir string)
  toNumber(ctrlName: string) {
    const v = Number(this.form.get(ctrlName)?.value);
    if (!Number.isNaN(v)) this.form.get(ctrlName)?.setValue(v, { emitEvent: false });
  }

  // debug para ver qué controles están inválidos
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
      // 1) crear libro
      const payload = {
        ...this.form.value,
        id_usuario: me.id,       // dueño
        disponible: true,        // por defecto disponible
      };
      const created: any = await firstValueFrom(this.books.create(payload));
      const libroId = Number(created?.id || created?.id_libro);

      // 2) subir imágenes (portada primero)
      if (libroId && this.files.length) {
        const portada = this.files[this.coverIndex];
        await firstValueFrom(this.books.uploadImage(libroId, portada, { is_portada: true, orden: 1 }));
        const others = this.files.filter((_, idx) => idx !== this.coverIndex);
        let orden = 2;
        for (const f of others) {
          await firstValueFrom(this.books.uploadImage(libroId, f, { is_portada: false, orden }));
          orden++;
        }
      }

      await loading.dismiss();
      this.toast('¡Libro publicado!');
      this.router.navigateByUrl('/my-books', { replaceUrl: true });
    } catch (e: any) {
      await loading.dismiss();
      this.sending = false;
      const msg = e?.error?.detail || e?.error?.message || 'Error al publicar';
      this.toast(msg);
    }
  }

  async toast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2000, position: 'bottom' });
    await t.present();
  }

  ionViewWillLeave() {
    this.previews.forEach(url => URL.revokeObjectURL(url));
  }
}
