import { CommonModule } from '@angular/common'; // NgIf/NgFor
import { Component, ViewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

// Ionic (puedes usar IonicModule completo para no listar uno a uno)
import { IonContent, IonicModule, LoadingController, ToastController } from '@ionic/angular';

import { AuthService } from 'src/app/core/services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],

  // ⬇️ MUY IMPORTANTE
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonicModule,     // trae ion-header, ion-content, ion-item, ion-input, etc.
    RouterLink       // para el <a routerLink="...">
  ],
})
export class LoginPage {
   @ViewChild(IonContent, { static: true }) content!: IonContent;

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private toast: ToastController,
    private loadingCtrl: LoadingController
  ) { }

  ionViewWillEnter() {
    // Espera al frame y sube al tope (sin animación)
    requestAnimationFrame(() => this.content?.scrollToTop(0));
    // por si la vista anterior dejó el scroll del documento
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }

  async submit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    const loading = await this.loadingCtrl.create({ message: 'Ingresando...' });
    await loading.present();

    try {
      const { email, password } = this.form.value;
      await this.auth.login(email!, password!);

      // ✅ Toast de éxito
      (await this.toast.create({
        message: 'Sesión iniciada',
        duration: 2000,
        color: 'success'
      })).present();

      await loading.dismiss();
      this.router.navigateByUrl('/home', { replaceUrl: true });
    } catch (err: any) {
      await loading.dismiss();
      const msg = err?.error?.detail || err?.error?.error || 'No se pudo iniciar sesión';
      (await this.toast.create({ message: msg, color: 'danger', duration: 2500 })).present();
    }
  }
}
