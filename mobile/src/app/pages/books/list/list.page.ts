//pages/books/list/list.page.ts

import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonButtons, IonContent, IonHeader, IonItem, IonLabel, IonList,
  IonMenuButton, IonSearchbar, IonTitle, IonToolbar
} from '@ionic/angular/standalone';
import { BooksService, Libro } from '../../../core/services/books.service';

@Component({
  selector: 'app-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton,
    IonSearchbar, IonList, IonItem, IonLabel,
    RouterLink
  ],
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ListPage implements OnInit {
  q = '';
  loading = false;
  items: Libro[] = [];

  constructor(private booksSvc: BooksService, private router: Router) { }
  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.booksSvc.listDistinct(this.q).subscribe({
      next: data => { this.items = data; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  openTitle(title: string) {
    this.router.navigate(['/books/by-title', encodeURIComponent(title)]);
  }

  search() {
    this.loading = true;
    this.booksSvc.listDistinct(this.q).subscribe({
      next: data => { this.items = data; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }
}