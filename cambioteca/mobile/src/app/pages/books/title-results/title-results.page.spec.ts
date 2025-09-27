import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { TitleResultsPage } from './title-results.page';

describe('TitleResultsPage', () => {
  let component: TitleResultsPage;
  let fixture: ComponentFixture<TitleResultsPage>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [TitleResultsPage],
    }).compileComponents();

    fixture = TestBed.createComponent(TitleResultsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
