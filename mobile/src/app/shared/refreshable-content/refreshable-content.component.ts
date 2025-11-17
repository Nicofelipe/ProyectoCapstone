import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { IonContent, IonRefresher, IonRefresherContent } from '@ionic/angular/standalone';

@Component({
    selector: 'app-refreshable-content',
    standalone: true,
    imports: [CommonModule, IonContent, IonRefresher, IonRefresherContent],
    template: `
  <ion-content [fullscreen]="true">
    <ion-refresher slot="fixed" [disabled]="disabled" (ionRefresh)="onRefresh($event)">
      <ion-refresher-content
        pullingText="Desliza para actualizar"
        refreshingSpinner="circles"
        refreshingText="Actualizando…">
      </ion-refresher-content>
    </ion-refresher>
    <ng-content></ng-content>
  </ion-content>
  `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RefreshableContentComponent {
    @Input() disabled = false;
    // función que la página le pasa para recargar datos
    @Input() refreshFn?: () => Promise<any> | void;

    async onRefresh(ev: Event) {
        try { if (this.refreshFn) await this.refreshFn(); }
        finally { (ev.target as HTMLIonRefresherElement).complete(); }
    }
}
