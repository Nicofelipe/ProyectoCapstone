// src/app/pages/my-books/profile.page.ts
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { AuthService, MeUser } from 'src/app/core/services/auth.service';
import { environment } from 'src/environments/environment';

// 👇 NUEVO: Capacitor Camera
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

const STRONG_PWD_RX = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^\w\s]).{8,}$/;
function matchPasswords(ctrl: AbstractControl) {
  const p = ctrl.get('password')?.value;
  const c = ctrl.get('confirm')?.value;
  return p && c && p === c ? null : { mismatch: true };
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, IonicModule, ReactiveFormsModule],
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
})
export class ProfilePage implements OnInit, OnDestroy {
  // Tabs
  tab = signal<'info' | 'history' | 'settings'>('info');

  // Cambiar password
  showPwd = signal(false);
  busyPwd = false;
  pwdForm = this.fb.group({
    current: ['', [Validators.required]],
    password: ['', [Validators.required, Validators.pattern(STRONG_PWD_RX)]],
    confirm: ['', [Validators.required]],
  }, { validators: matchPasswords });

  // Estado
  user = signal<MeUser | null>(null);
  metrics = signal<{ libros: number; intercambios: number; calificacion: number | null }>({
    libros: 0,
    intercambios: 0,
    calificacion: null,
  });
  history = signal<{ id: number; titulo: string; estado: string; fecha?: string }[]>([]);
  editMode = signal(false);

  // Modal de avatar
  avatarModal = signal(false);

  // Form
  form = this.fb.nonNullable.group({
    nombres: ['', [Validators.required, Validators.maxLength(150)]],
    apellido_paterno: ['', [Validators.maxLength(100)]],
    apellido_materno: ['', [Validators.maxLength(100)]],
    telefono: ['', [Validators.maxLength(15)]],
    direccion: ['', [Validators.maxLength(255)]],
    numeracion: ['', [Validators.maxLength(10)]],
  });

  // Media
  mediaBase = environment.mediaBase || `${environment.apiUrl}/media/`;

  avatarUrl = computed(() => {
    const u = this.user();
    const rel = (u?.imagen_perfil || '').trim().replace(/^\/+/, '');
    return rel ? `${this.mediaBase}${rel}` : `${this.mediaBase}avatars/avatardefecto.jpg`;
  });

  fullName = computed(() => {
    const u = this.user(); if (!u) return '';
    const ap = (u.apellido_paterno || '').trim();
    const am = (u.apellido_materno || '').trim();
    return `${u.nombres}${ap ? ' ' + ap : ''}${am ? ' ' + am : ''}`.trim();
  });

  // Estrellas calculadas (con medias)
  stars = computed(() => {
    const rating = Number(this.metrics().calificacion ?? 0);
    const full = Math.floor(rating);
    const frac = rating - full;
    const hasExtraFull = frac >= 0.75 ? 1 : 0;
    const hasHalf = frac >= 0.25 && frac < 0.75 ? 1 : 0;
    const icons: string[] = [];
    for (let i = 0; i < Math.min(5, full + hasExtraFull); i++) icons.push('star');
    if (icons.length < 5 && hasHalf) icons.push('star-half');
    while (icons.length < 5) icons.push('star-outline');
    return icons;
  });

  private sub?: Subscription;

  constructor(
    private auth: AuthService,
    private router: Router,
    private toast: ToastController,
    private fb: FormBuilder,
  ) {
    // Suscribirse a cambios de sesión
    this.sub = this.auth.user$.subscribe((u) => {
      this.user.set(u);
      if (u) {
        this.preloadForm(u);
      } else {
        this.metrics.set({ libros: 0, intercambios: 0, calificacion: null });
        this.history.set([]);
      }
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  private preloadForm(u: MeUser) {
    this.form.patchValue(
      {
        nombres: u.nombres ?? '',
        apellido_paterno: u.apellido_paterno ?? '',
        apellido_materno: u.apellido_materno ?? '',
        telefono: (u as any).telefono ?? '',
        direccion: (u as any).direccion ?? '',
        numeracion: (u as any).numeracion ?? '',
      },
      { emitEvent: false }
    );
  }

  async ngOnInit() {
    // En caso de entrar directo por URL
    await this.ionViewWillEnter();
  }

  // Ionic hook
  async ionViewWillEnter() {
    await this.auth.restoreSession();
    const me = this.auth.user;
    if (!me) {
      this.router.navigateByUrl('/auth/login');
      return;
    }
    await this.loadSummary(me.id);
  }

  private async loadSummary(id: number) {
    try {
      const s = await this.auth.getUserSummary(id);
      const mapped: MeUser = {
        id: s.user.id_usuario,
        email: s.user.email,
        nombres: s.user.nombres,
        apellido_paterno: s.user.apellido_paterno,
        apellido_materno: s.user.apellido_materno,
        nombre_usuario: s.user.nombre_usuario,
        imagen_perfil: s.user.imagen_perfil || null,
        verificado: !!s.user.verificado,
        rut: s.user.rut || undefined,
        calificacion: s.metrics?.calificacion ?? undefined,
        telefono: s.user.telefono ?? undefined,
        direccion: s.user.direccion ?? undefined,
        numeracion: s.user.numeracion ?? undefined,
        direccion_completa: s.user.direccion_completa ?? undefined,
      };

      this.user.set(mapped);
      await this.auth.setUserLocal(mapped);

      this.metrics.set({
        libros: Number(s.metrics?.libros ?? 0),
        intercambios: Number(s.metrics?.intercambios ?? 0),
        calificacion: s.metrics?.calificacion ?? null,
      });
      this.history.set(Array.isArray(s.history) ? s.history : []);
      this.preloadForm(mapped);
    } catch (e) {
      console.error('GET /api/users/:id/summary falló', e);
      (await this.toast.create({ message: 'No se pudo cargar el perfil', color: 'danger', duration: 2000 })).present();
    }
  }

  goMyRatings(): void {
    const u = this.user(); // signal

    if (!u || !u.id) {
      console.warn('No hay usuario logueado para ver calificaciones');
      return;
    }

    this.router.navigate(
      ['/users', u.id, 'ratings'],
      {
        queryParams: {
          name: u.nombre_usuario || u.nombres || u.email,
        },
      }
    );
  }


  // ====== UI ======
  setTab(t: 'info' | 'history' | 'settings') { this.tab.set(t); }
  toggleEdit() { this.editMode.update(v => !v); }

  // ====== AVATAR / CÁMARA ======
  openAvatarModal() { this.avatarModal.set(true); }
  closeAvatarModal() { this.avatarModal.set(false); }

  // Pide permisos en Android/iOS (en web el navegador los maneja)
  private async ensurePermissions(): Promise<boolean> {
    if (Capacitor.getPlatform() === 'web') return true;
    try {
      let status = await Camera.checkPermissions();
      const ok = status.camera === 'granted' && (status.photos === 'granted' || status.photos === 'limited');
      if (ok) return true;

      status = await Camera.requestPermissions({ permissions: ['camera', 'photos'] as any });
      const granted = status.camera === 'granted' && (status.photos === 'granted' || status.photos === 'limited');
      if (!granted) {
        (await this.toast.create({
          message: 'Activa los permisos de cámara/galería en Ajustes del sistema.',
          duration: 2200
        })).present();
      }
      return granted;
    } catch {
      return true;
    }
  }

  // Abre prompt nativo (Cámara/Galería). Si falla, usa el input oculto.
  async pickAvatar(fallbackInput: HTMLInputElement) {
    try {
      if (!(await this.ensurePermissions())) return;

      const photo = await Camera.getPhoto({
        quality: 70,
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt,
        saveToGallery: false,
        correctOrientation: true,
        promptLabelHeader: 'Elegir foto',
        promptLabelPhoto: 'Galería',
        promptLabelPicture: 'Cámara',
      });

      if (!photo?.webPath || !this.user()) return;

      const f = await this.fileFromWebPath(photo.webPath, photo.format);
      const mini = await this.downscaleIfNeeded(f, 1024, 0.82);
      await this.uploadAvatar(mini);
    } catch {
      // PWA/desktop o error → fallback al input
      fallbackInput.click();
    }
  }

  // Fallback input[type=file]
  async onAvatarSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite volver a elegir la misma foto
    if (!file || !this.user()) return;

    try {
      const mini = await this.downscaleIfNeeded(file, 1024, 0.82);
      await this.uploadAvatar(mini);
    } catch {
      (await this.toast.create({ message: 'No se pudo procesar la imagen', duration: 1800, color: 'danger' })).present();
    } finally {
      this.closeAvatarModal();
    }
  }

  // Helpers de imagen
  private async fileFromWebPath(webPath: string, fmt?: string): Promise<File> {
    const r = await fetch(webPath);
    const blob = await r.blob();
    const ext = (fmt || '').toLowerCase();
    const name = `avatar_${Date.now()}.${ext && ext !== 'heic' && ext !== 'heif' ? ext : 'jpg'}`;
    return new File([blob], name, { type: blob.type || 'image/jpeg' });
  }

  private async downscaleIfNeeded(file: File, maxSide = 1024, quality = 0.82): Promise<File> {
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const el = new Image();
        el.onload = () => res(el);
        el.onerror = rej;
        el.src = URL.createObjectURL(file);
      });

      const w = img.width, h = img.height;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      if (scale >= 1) { URL.revokeObjectURL(img.src); return file; }

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const blob: Blob = await new Promise((res) =>
        canvas.toBlob(b => res(b as Blob), 'image/jpeg', quality)
      );

      URL.revokeObjectURL(img.src);
      return new File(
        [blob],
        file.name.replace(/\.(heic|heif|png|webp|jpg|jpeg)$/i, '.jpg'),
        { type: 'image/jpeg' }
      );
    } catch {
      return file;
    }
  }

  private async uploadAvatar(file: File) {
    try {
      await this.auth.updateAvatar(this.user()!.id, file);
      await this.loadSummary(this.user()!.id); // refresca URL normalizada
      (await this.toast.create({ message: 'Imagen actualizada', duration: 1500, color: 'success' })).present();
    } catch (e: any) {
      const detail = e?.error?.detail || e?.error?.message || 'No se pudo actualizar la imagen';
      (await this.toast.create({ message: detail, duration: 2200, color: 'danger' })).present();
    }
  }

  // ====== Guardar datos ======
  async save() {
    if (this.form.invalid || !this.user()) return;
    const id = this.user()!.id;
    const payload = this.form.getRawValue();

    try {
      await this.auth.updateMyProfile(id, payload);
      await this.loadSummary(id);
      (await this.toast.create({ message: 'Perfil actualizado', duration: 1600, color: 'success' })).present();
      this.editMode.set(false);
    } catch {
      (await this.toast.create({ message: 'No se pudo actualizar', duration: 1800, color: 'danger' })).present();
    }
  }

  togglePwd() { this.showPwd.update(v => !v); }

  async submitPwd() {
    if (this.pwdForm.invalid) { this.pwdForm.markAllAsTouched(); return; }
    this.busyPwd = true;
    try {
      const { current, password } = this.pwdForm.value;
      await this.auth.changePassword(current!, password!);

      (await this.toast.create({
        message: 'Contraseña actualizada correctamente.',
        duration: 2000,
        color: 'success'
      })).present();

      this.pwdForm.reset();
      this.showPwd.set(false);
    } catch (e: any) {
      const msg = e?.error?.detail || e?.error?.message || 'No se pudo actualizar la contraseña';
      (await this.toast.create({ message: msg, color: 'danger', duration: 2500 })).present();
    } finally {
      this.busyPwd = false;
    }
  }

  async doLogout() {
    await this.auth.logout();
    (await this.toast.create({ message: 'Sesión cerrada', duration: 1800 })).present();
    this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }
}
