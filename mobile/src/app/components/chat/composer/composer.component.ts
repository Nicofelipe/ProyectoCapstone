import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-composer',
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  template: `
  <div class="composer">
    <ion-input
      [(ngModel)]="text"
      placeholder="Escribe un mensaje…"
      (keyup.enter)="emit()"
    ></ion-input>

    <ion-button (click)="emit()" [disabled]="!text.trim()">
      <ion-icon name="send-outline"></ion-icon>
    </ion-button>
  </div>
  `,
  styles: [`
  .composer{
    display:flex; gap:8px; padding:8px; align-items:center;
    border-top:1px solid rgba(0,0,0,.06); background:#fafafa;
  }
  ion-input{ flex:1 }
  `]
})
export class ComposerComponent {
  @Output() send = new EventEmitter<string>();
  text = '';

  emit() {
    const t = this.text.trim();
    if (!t) return;
    this.send.emit(t);
    this.text = '';
  }
}
