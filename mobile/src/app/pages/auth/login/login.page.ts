import { CommonModule } from '@angular/common'; // NgIf/NgFor
import { Component } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

// Ionic (puedes usar IonicModule completo para no listar uno a uno)
import { IonicModule, LoadingController, ToastController } from '@ionic/angular';

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
