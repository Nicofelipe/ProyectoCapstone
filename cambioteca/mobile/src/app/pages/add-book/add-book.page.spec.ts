import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AddBookPage } from './add-book.page';

describe('AddBookPage', () => {
  let component: AddBookPage;
  let fixture: ComponentFixture<AddBookPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(AddBookPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
