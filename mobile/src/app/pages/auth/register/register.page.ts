import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import {
  IonAvatar,
  IonButton, IonButtons, IonContent, IonHeader,
  IonIcon, IonInput, IonItem, IonList,
  IonMenuButton, IonNote, IonSelect, IonSelectOption,
  IonTitle, IonToolbar,
} from '@ionic/angular/standalone';
import { AuthService } from 'src/app/core/services/auth.service';
import { CatalogService, Comuna, Region } from 'src/app/core/services/catalog.service';

// Regex
const NAME_RX        = /^[A-Za-zÁÉÍÓÚÑáéíóúñ\s]+$/; // solo letras y espacios
const RUT_RX         = /^\d{7,8}-[\dkK]$/;           // 7-8 números + '-' + dígito o k/K
const PHONE_RX       = /^\d{7,12}$/;                 // 7–12 dígitos
const NUMERACION_RX  = /^[A-Za-z0-9\-]{1,10}$/;      // ej. 123, 123-A
const STRONG_PWD_RX  = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^\w\s]).{8,}$/;

// Validador cruzado para comparar dos controles
function matchFields(field: string, confirmField: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const a = group.get(field)?.value ?? '';
    const b = group.get(confirmField)?.value ?? '';
    return a === b ? null : { [confirmField + 'Mismatch']: true };
  };
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, RouterModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
    IonContent, IonItem, IonInput, IonButton, IonList,
    IonSelect, IonSelectOption, IonAvatar, IonIcon, IonNote,
  ],
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class RegisterPage implements OnInit {
  regiones: Region[] = [];
  comunas: Comuna[] = [];

  // archivo seleccionado y preview
  selectedFile: File | null = null;
  previewUrl: string | null = null;

  busy = false;

  form = this.fb.group({
    rut: ['', [Validators.required, Validators.pattern(RUT_RX)]],
    nombres: ['', [Validators.required, Validators.pattern(NAME_RX)]],
    apellido_paterno: ['', [Validators.required, Validators.pattern(NAME_RX)]],
    apellido_materno: ['', [Validators.required, Validators.pattern(NAME_RX)]],
    nombre_usuario: ['', [Validators.required]],

    // Email + confirmación
    email:  ['', [Validators.required, Validators.email]],
    email2: ['', [Validators.required, Validators.email]],

    telefono: ['', [Validators.required, Validators.pattern(PHONE_RX)]],
    direccion: ['', [Validators.required]],
    numeracion: ['', [Validators.required, Validators.pattern(NUMERACION_RX)]],
    region: [null as number | null, [Validators.required]],
    comuna: [null as number | null, [Validators.required]],

    // Contraseña + confirmación
    contrasena:  ['', [Validators.required, Validators.pattern(STRONG_PWD_RX)]],
    contrasena2: ['', [Validators.required, Validators.pattern(STRONG_PWD_RX)]],
  }, {
    validators: [
      matchFields('email', 'email2'),
      matchFields('contrasena', 'contrasena2'),
    ]
  });

  constructor(
    private fb: FormBuilder,
    private catalog: CatalogService,
    private auth: AuthService,
    private toast: ToastController,
    private loadingCtrl: LoadingController,
    private router: Router,
  ) {}

  async ngOnInit() {
    this.regiones = await this.catalog.regiones();
    this.form.get('region')?.valueChanges.subscribe(async (id) => {
      this.form.patchValue({ comuna: null });
      this.comunas = id ? await this.catalog.comunas(id) : [];
    });
  }

  async onRegionChange(regionId: number | null) {
    if (regionId) {
      this.comunas = await this.catalog.comunas(regionId);
      this.form.patchValue({ comuna: null });
    } else {
      this.comunas = [];
      this.form.patchValue({ comuna: null });
    }
  }

  onPickImage(input: HTMLInputElement) { input.click(); }

  onFileSelected(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0] || null;
    this.selectedFile = file;
    if (file) {
      const reader = new FileReader();
      reader.onload = () => this.previewUrl = String(reader.result);
      reader.readAsDataURL(file);
    } else {
      this.previewUrl = null;
    }
  }

  removeImage(input: HTMLInputElement) {
    this.selectedFile = null;
    this.previewUrl = null;
    if (input) input.value = '';
  }

  // helpers para template
  get f() { return this.form.controls; }
  get emailMismatch() { return this.form.hasError('email2Mismatch') && (this.f.email2.touched || this.f.email.touched); }
  get pwdMismatch()   { return this.form.hasError('contrasena2Mismatch') && (this.f.contrasena2.touched || this.f.contrasena.touched); }

  async submit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    this.busy = true;
    const overlay = await this.loadingCtrl.create({ message: 'Creando cuenta...' });
    await overlay.present();

    try {
      const v = this.form.value;
      const fd = new FormData();

      fd.append('rut', v.rut!);
      fd.append('nombres', v.nombres!);
      fd.append('apellido_paterno', v.apellido_paterno!);
      fd.append('apellido_materno', v.apellido_materno!);
      fd.append('nombre_usuario', v.nombre_usuario!);

      // ya están validadas las coincidencias: usa el primero
      fd.append('email', v.email!);

      fd.append('telefono', v.telefono!);
      fd.append('direccion', v.direccion!);
      fd.append('numeracion', v.numeracion!);
      fd.append('comuna', String(v.comuna!));
      fd.append('contrasena', v.contrasena!);

      if (this.selectedFile) fd.append('imagen_perfil', this.selectedFile);

      await this.auth.registerFormData(fd);

      await overlay.dismiss();
      this.busy = false;
      (await this.toast.create({
        message: 'Cuenta creada. Ahora inicia sesión.',
        duration: 2000, color: 'success'
      })).present();

      this.router.navigateByUrl('/auth/login', { replaceUrl: true });
    } catch (e: any) {
      await overlay.dismiss();
      this.busy = false;
      const msg = e?.error ? (typeof e.error === 'string' ? e.error : JSON.stringify(e.error)) : 'No se pudo registrar.';
      (await this.toast.create({ message: msg, duration: 2500, color: 'danger' })).present();
    }
  }
}