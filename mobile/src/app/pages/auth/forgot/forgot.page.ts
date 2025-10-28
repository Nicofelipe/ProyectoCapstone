import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ToastController } from '@ionic/angular';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem,
  IonList, IonMenuButton, IonNote, IonTitle, IonToolbar
} from '@ionic/angular/standalone';
import { AuthService } from 'src/app/core/services/auth.service';

@Component({
  selector: 'app-forgot',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
    IonContent, IonItem, IonInput, IonButton, IonList, IonNote
  ],
  templateUrl: './forgot.page.html',
  styleUrls: ['./forgot.page.scss']
})
export class ForgotPage {
  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });
  busy = false;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,            // ✅ DI correcto (no uses import(...) como tipo)
    private toast: ToastController
  ) {}

  async submit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.busy = true;
    try {
      await this.auth.requestPasswordReset(this.form.value.email!);
      (await this.toast.create({
        message: 'Si el correo existe, te enviamos un enlace para restablecer.',
        duration: 2500, color: 'success'
      })).present();
      this.form.reset();
    } catch (e: any) {
      (await this.toast.create({
        message: e?.error ? JSON.stringify(e.error) : 'No se pudo enviar el correo.',
        duration: 2500, color: 'danger'
      })).present();
    } finally {
      this.busy = false;
    }
  }

  get f() { return this.form.controls; }
}
