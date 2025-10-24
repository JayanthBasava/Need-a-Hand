// Single-file Angular app for "Need A Hand?" — Handy AI Marketplace
// All components, services, interfaces, logic, and styling are contained here.

// Angular core and platform
import {
  Component,
  Injectable,
  signal,
  computed,
  effect,
  inject,
  OnInit,
  Input,
  Output,
  EventEmitter
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { bootstrapApplication } from '@angular/platform-browser';

// Firebase SDK (modular)
import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCustomToken,
  signOut as firebaseSignOut,
  type User as FirebaseUser
} from 'firebase/auth';
import {
  getFirestore,
  Firestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  type Unsubscribe
} from 'firebase/firestore';

// ---- Globals for dynamic configuration ----
declare global {
  interface Window {
    __firebase_config?: any;
    __app_id?: string;
    __initial_auth_token?: string;
  }
}

// ---- Domain Models ----
export type Role = 'Customer' | 'Worker';

export interface UserProfileBase {
  id: string;
  name: string;
  role: Role;
  location: string;
}

export interface CustomerProfile extends UserProfileBase {
  role: 'Customer';
}

export interface WorkerProfile extends UserProfileBase {
  role: 'Worker';
  specialty: string;
  bio: string;
  rating: number; // 0..5
  jobsCompleted: number;
  available: boolean;
  skills: string[];
  hourlyRate: number; // USD
}

export type JobStatus = 'Pending' | 'Accepted' | 'Completed' | 'Canceled';

export interface Job {
  id: string;
  customerId: string;
  workerId: string;
  category: ServiceCategoryId;
  description: string;
  status: JobStatus;
  createdAt?: any;
  updatedAt?: any;
}

export type ServiceCategoryId = 'Plumber' | 'Electrician' | 'Painter' | 'Driver' | 'General';

export type FaqType = 'text' | 'boolean' | 'select';

export interface FaqItem {
  id: string;
  type: FaqType;
  question: string;
  options?: string[]; // For select
}

export interface CategoryDefinition {
  id: ServiceCategoryId;
  title: string;
  icon: string; // inline SVG path or emoji
  keywords: string[];
  faqs: FaqItem[];
}

// ---- Category Definitions with FAQs ----
const CATEGORY_DEFS: CategoryDefinition[] = [
  {
    id: 'Plumber',
    title: 'Plumber',
    icon: '🛠️',
    keywords: ['leak', 'pipe', 'sink', 'drain', 'toilet', 'water heater', 'clog', 'faucet', 'sewer'],
    faqs: [
      { id: 'location', type: 'select', question: 'Where is the issue located?', options: ['Kitchen', 'Bathroom', 'Basement', 'Laundry', 'Outdoor'] },
      { id: 'severity', type: 'select', question: 'How severe is the issue?', options: ['Minor drip', 'Slow drain', 'No water', 'Flooding'] },
      { id: 'shutoff', type: 'boolean', question: 'Have you tried shutting off the water?' },
      { id: 'age', type: 'select', question: 'Approximate age of the fixture?', options: ['<1 year', '1-3 years', '3-5 years', '5+ years', 'Unknown'] }
    ]
  },
  {
    id: 'Electrician',
    title: 'Electrician',
    icon: '💡',
    keywords: ['outlet', 'breaker', 'fuse', 'light', 'wiring', 'short', 'power', 'spark', 'switch'],
    faqs: [
      { id: 'scope', type: 'select', question: 'Which is affected?', options: ['Single outlet', 'Room', 'Multiple rooms', 'Whole home'] },
      { id: 'breaker', type: 'boolean', question: 'Did the breaker trip?' },
      { id: 'smell', type: 'boolean', question: 'Do you notice burning smell?' },
      { id: 'age', type: 'select', question: 'Age of electrical system?', options: ['<5 years', '5-10 years', '10-20 years', '20+ years', 'Unknown'] }
    ]
  },
  {
    id: 'Painter',
    title: 'Painter',
    icon: '🎨',
    keywords: ['paint', 'wall', 'peel', 'crack', 'color', 'primer', 'roller', 'brush', 'exterior', 'interior'],
    faqs: [
      { id: 'area', type: 'select', question: 'Where do you need painting?', options: ['Interior walls', 'Ceiling', 'Exterior walls', 'Trim/Doors', 'Fence/Deck'] },
      { id: 'size', type: 'select', question: 'Approximate area size?', options: ['<100 sq ft', '100-300 sq ft', '300-600 sq ft', '600+ sq ft'] },
      { id: 'finish', type: 'select', question: 'Preferred finish?', options: ['Matte', 'Eggshell', 'Satin', 'Semi-gloss', 'Gloss'] },
      { id: 'prep', type: 'boolean', question: 'Is surface prep (sanding/patching) needed?' }
    ]
  },
  {
    id: 'Driver',
    title: 'Driver',
    icon: '🚗',
    keywords: ['ride', 'drive', 'pickup', 'drop off', 'transport', 'deliver', 'airport', 'taxi', 'car'],
    faqs: [
      { id: 'vehicle', type: 'select', question: 'Vehicle type needed?', options: ['Sedan', 'SUV', 'Van/Truck', 'No preference'] },
      { id: 'distance', type: 'select', question: 'Trip distance?', options: ['<5 miles', '5-15 miles', '15-30 miles', '30+ miles'] },
      { id: 'time', type: 'select', question: 'When do you need it?', options: ['ASAP', 'Today', 'This week', 'Later date'] },
      { id: 'luggage', type: 'boolean', question: 'Do you have large luggage/items?' }
    ]
  },
  {
    id: 'General',
    title: 'General Help',
    icon: '🧰',
    keywords: ['help', 'handyman', 'task', 'assemble', 'mount', 'fix', 'repair', 'install', 'move'],
    faqs: [
      { id: 'task', type: 'text', question: 'Briefly describe the task' },
      { id: 'urgency', type: 'select', question: 'How urgent is it?', options: ['ASAP', 'Today', 'This week', 'Flexible'] },
      { id: 'tools', type: 'boolean', question: 'Do you have necessary tools?' }
    ]
  }
];

const CATEGORY_BY_ID: Record<ServiceCategoryId, CategoryDefinition> = CATEGORY_DEFS.reduce((acc, c) => {
  acc[c.id] = c; return acc;
}, {} as Record<ServiceCategoryId, CategoryDefinition>);

// ---- Utility ----
function classNames(...list: Array<string | false | null | undefined>): string {
  return list.filter(Boolean).join(' ');
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---- Firebase Service ----
@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private appId = (window.__app_id as string) || 'demo-handyaid-app';
  private firebaseConfig = (window.__firebase_config as any) || null;

  private app?: FirebaseApp;
  private auth = getAuth();
  private db?: Firestore;

  readonly isInitializing = signal<boolean>(true);
  readonly currentFirebaseUser = signal<FirebaseUser | null>(null);
  readonly userProfile = signal<CustomerProfile | WorkerProfile | null>(null);

  // Public discovery
  readonly allWorkers = signal<WorkerProfile[]>([]);

  // Jobs
  readonly myJobsAsCustomer = signal<Job[]>([]);
  readonly myJobsAsWorker = signal<Job[]>([]);

  private workersUnsub?: Unsubscribe;
  private jobsCustomerUnsub?: Unsubscribe;
  private jobsWorkerUnsub?: Unsubscribe;

  constructor() {
    // Lazy init to allow external config to be present
    this.initializeFirebase();
  }

  private async initializeFirebase(): Promise<void> {
    try {
      if (!this.firebaseConfig) {
        console.warn('Firebase config missing on window.__firebase_config; app in demo mode.');
        // Still allow auth to exist but db ops will be no-op
      }
      if (!this.app && this.firebaseConfig) {
        this.app = initializeApp(this.firebaseConfig);
      }
      if (!this.db && this.firebaseConfig) {
        this.db = getFirestore();
      }

      // Attach auth listener
      onAuthStateChanged(this.auth, async (u) => {
        this.currentFirebaseUser.set(u);
        if (u && this.db) {
          await this.loadUserProfile(u.uid);
          this.attachWorkersListener();
          this.attachJobsListeners();
        } else {
          this.userProfile.set(null);
          this.detachWorkersListener();
          this.detachJobsListeners();
        }
        this.isInitializing.set(false);
      });

      // Optional auto sign-in via custom token
      const token = (window.__initial_auth_token as string) || '';
      if (token) {
        try {
          await signInWithCustomToken(this.auth, token);
          // Profile might not exist; UI will allow role-setup
        } catch (e) {
          console.warn('Custom token sign-in failed, falling back to anonymous:', e);
          await signInAnonymously(this.auth);
        }
      }
    } catch (err) {
      console.error('Firebase initialization error', err);
      this.isInitializing.set(false);
    }
  }

  private profileDocRef(uid: string) {
    if (!this.db) return null;
    return doc(this.db, 'artifacts', this.appId, 'users', uid, 'metadata', 'profile');
  }

  private publicWorkersColRef() {
    if (!this.db) return null;
    return collection(this.db, 'artifacts', this.appId, 'public', 'data', 'workers');
  }

  private publicJobsColRef() {
    if (!this.db) return null;
    return collection(this.db, 'artifacts', this.appId, 'public', 'data', 'jobs');
  }

  private async loadUserProfile(uid: string): Promise<void> {
    const ref = this.profileDocRef(uid);
    if (!ref) return;
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as any;
      if (data.role === 'Worker') {
        const profile: WorkerProfile = {
          id: uid,
          name: data.name || 'Worker',
          role: 'Worker',
          location: data.location || 'Unknown',
          specialty: data.specialty || 'General',
          bio: data.bio || '',
          rating: data.rating ?? 4.7,
          jobsCompleted: data.jobsCompleted ?? 0,
          available: data.available ?? true,
          skills: data.skills || [],
          hourlyRate: data.hourlyRate ?? 50,
        };
        this.userProfile.set(profile);
      } else {
        const profile: CustomerProfile = {
          id: uid,
          name: data.name || 'Customer',
          role: 'Customer',
          location: data.location || 'Unknown',
        };
        this.userProfile.set(profile);
      }
    } else {
      this.userProfile.set(null);
    }
  }

  private attachWorkersListener(): void {
    this.detachWorkersListener();
    const colRef = this.publicWorkersColRef();
    if (!colRef) return;
    this.workersUnsub = onSnapshot(colRef, (snap) => {
      const workers: WorkerProfile[] = [];
      snap.forEach((d) => {
        const wd = d.data() as any;
        const w: WorkerProfile = {
          id: d.id,
          name: wd.name || 'Worker',
          role: 'Worker',
          location: wd.location || 'Unknown',
          specialty: wd.specialty || 'General',
          bio: wd.bio || '',
          rating: wd.rating ?? 4.5,
          jobsCompleted: wd.jobsCompleted ?? 0,
          available: wd.available ?? true,
          skills: wd.skills || [],
          hourlyRate: wd.hourlyRate ?? 50,
        };
        workers.push(w);
      });
      // Stable order: available first, then rating desc
      workers.sort((a, b) => (Number(b.available) - Number(a.available)) || (b.rating - a.rating));
      this.allWorkers.set(workers);
    });
  }

  private attachJobsListeners(): void {
    this.detachJobsListeners();
    if (!this.db) return;
    const user = this.currentFirebaseUser();
    if (!user) return;

    const jobsCol = this.publicJobsColRef();
    if (!jobsCol) return;

    // Customer jobs
    const qCust = query(jobsCol, where('customerId', '==', user.uid));
    this.jobsCustomerUnsub = onSnapshot(qCust, (snap) => {
      const items: Job[] = [];
      snap.forEach((d) => {
        const jd = d.data() as any;
        items.push({
          id: d.id,
          customerId: jd.customerId,
          workerId: jd.workerId,
          category: jd.category,
          description: jd.description,
          status: jd.status,
          createdAt: jd.createdAt,
          updatedAt: jd.updatedAt,
        });
      });
      // Newest first by createdAt if present
      items.sort((a, b) => {
        const at = (a.createdAt?.toMillis?.() ?? 0);
        const bt = (b.createdAt?.toMillis?.() ?? 0);
        return bt - at;
      });
      this.myJobsAsCustomer.set(items);
    });

    // Worker jobs assigned to me
    const qWork = query(jobsCol, where('workerId', '==', user.uid));
    this.jobsWorkerUnsub = onSnapshot(qWork, (snap) => {
      const items: Job[] = [];
      snap.forEach((d) => {
        const jd = d.data() as any;
        items.push({
          id: d.id,
          customerId: jd.customerId,
          workerId: jd.workerId,
          category: jd.category,
          description: jd.description,
          status: jd.status,
          createdAt: jd.createdAt,
          updatedAt: jd.updatedAt,
        });
      });
      items.sort((a, b) => {
        const at = (a.createdAt?.toMillis?.() ?? 0);
        const bt = (b.createdAt?.toMillis?.() ?? 0);
        return bt - at;
      });
      this.myJobsAsWorker.set(items);
    });
  }

  private detachWorkersListener(): void {
    if (this.workersUnsub) { this.workersUnsub(); this.workersUnsub = undefined; }
  }
  private detachJobsListeners(): void {
    if (this.jobsCustomerUnsub) { this.jobsCustomerUnsub(); this.jobsCustomerUnsub = undefined; }
    if (this.jobsWorkerUnsub) { this.jobsWorkerUnsub(); this.jobsWorkerUnsub = undefined; }
  }

  async signInAsCustomer(): Promise<void> {
    const user = this.currentFirebaseUser();
    if (!user) {
      await signInAnonymously(this.auth);
    }
    const u = this.currentFirebaseUser();
    if (!u || !this.db) return;

    const baseName = `Customer ${u.uid.slice(0, 6)}`;
    const profile: CustomerProfile = {
      id: u.uid,
      name: baseName,
      role: 'Customer',
      location: 'Nearby',
    };
    const ref = this.profileDocRef(u.uid);
    if (!ref) return;
    await setDoc(ref, profile, { merge: true });
    this.userProfile.set(profile);
  }

  async signInAsWorker(): Promise<void> {
    const user = this.currentFirebaseUser();
    if (!user) {
      await signInAnonymously(this.auth);
    }
    const u = this.currentFirebaseUser();
    if (!u || !this.db) return;

    // Seed a reasonable worker profile
    const specialties: Array<Pick<WorkerProfile, 'specialty' | 'skills'>> = [
      { specialty: 'Plumber', skills: ['plumbing', 'leak repair', 'drain cleaning', 'water heater'] },
      { specialty: 'Electrician', skills: ['wiring', 'breaker repair', 'lighting', 'outlets'] },
      { specialty: 'Painter', skills: ['painting', 'prep', 'interior', 'exterior', 'trim'] },
      { specialty: 'Driver', skills: ['driving', 'transport', 'delivery', 'airport runs'] },
      { specialty: 'General', skills: ['assembly', 'mounting', 'repair', 'install'] },
    ];
    const pick = specialties[randInt(0, specialties.length - 1)];

    const profile: WorkerProfile = {
      id: u.uid,
      name: `Worker ${u.uid.slice(0, 6)}`,
      role: 'Worker',
      location: 'Nearby',
      specialty: pick.specialty,
      bio: 'Skilled and reliable. Ready to help!',
      rating: Math.round((4 + Math.random()) * 10) / 10, // 4.0–5.0
      jobsCompleted: randInt(5, 120),
      available: true,
      skills: pick.skills,
      hourlyRate: randInt(30, 90),
    };

    const ref = this.profileDocRef(u.uid);
    if (!ref) return;
    await setDoc(ref, profile, { merge: true });
    this.userProfile.set(profile);

    // Also create/update public worker entry
    const workersCol = this.publicWorkersColRef();
    if (workersCol) {
      const wRef = doc(workersCol, u.uid);
      await setDoc(wRef, profile, { merge: true });
    }
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(this.auth);
    this.userProfile.set(null);
    this.allWorkers.set([]);
    this.myJobsAsCustomer.set([]);
    this.myJobsAsWorker.set([]);
  }

  async setWorkerAvailability(available: boolean): Promise<void> {
    const profile = this.userProfile();
    if (!profile || profile.role !== 'Worker' || !this.db) return;

    // Update private profile
    const ref = this.profileDocRef(profile.id);
    if (ref) {
      await updateDoc(ref, { available });
    }

    // Update public worker doc
    const workersCol = this.publicWorkersColRef();
    if (workersCol) {
      const wRef = doc(workersCol, profile.id);
      await setDoc(wRef, { available }, { merge: true });
    }

    this.userProfile.set({ ...profile, available });
  }

  async cancelJob(jobId: string): Promise<void> {
    if (!this.db) return;
    const jobsCol = this.publicJobsColRef();
    if (!jobsCol) return;
    const ref = doc(jobsCol, jobId);
    await updateDoc(ref, { status: 'Canceled', updatedAt: serverTimestamp() });
  }

  async acceptJob(jobId: string): Promise<void> {
    if (!this.db) return;
    const jobsCol = this.publicJobsColRef();
    if (!jobsCol) return;
    const ref = doc(jobsCol, jobId);
    await updateDoc(ref, { status: 'Accepted', updatedAt: serverTimestamp() });
  }

  async completeJob(jobId: string): Promise<void> {
    if (!this.db) return;
    const jobsCol = this.publicJobsColRef();
    if (!jobsCol) return;
    const ref = doc(jobsCol, jobId);
    await updateDoc(ref, { status: 'Completed', updatedAt: serverTimestamp() });
  }

  async createJobForWorker(worker: WorkerProfile, category: ServiceCategoryId, description: string): Promise<void> {
    const u = this.currentFirebaseUser();
    if (!u || !this.db) return;
    const jobsCol = this.publicJobsColRef();
    if (!jobsCol) return;

    // Use autogenerated id by using doc(collection)
    const jobRef = doc(jobsCol);
    const job: Job = {
      id: jobRef.id,
      customerId: u.uid,
      workerId: worker.id,
      category,
      description,
      status: 'Pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(jobRef, job);
  }
}

// ---- Reusable UI Components ----
@Component({
  selector: 'app-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div [ngClass]="cardClass">
      <ng-content></ng-content>
    </div>
  `
})
export class CardComponent {
  @Input() padding: string = 'p-4';
  @Input() hover: boolean = true;
  @Input() extraClasses: string = '';

  get cardClass(): string {
    return classNames(
      // White gradient card
      'bg-gradient-to-b from-white to-gray-100 text-gray-900 rounded-2xl shadow-lg',
      'ring-1 ring-white/60',
      // 3D hover effect
      this.hover ? 'transition transform-gpu hover:-translate-y-0.5 hover:scale-[1.01] active:translate-y-0.5 active:scale-[0.99] hover:shadow-xl' : '',
      this.padding,
      this.extraClasses
    );
  }
}

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="w-full">
      <input
        [attr.type]="type"
        [placeholder]="placeholder"
        [value]="value"
        (input)="onInput($event)"
        class="w-full px-4 py-3 rounded-lg bg-neutral-800 text-white placeholder:text-gray-400 outline-none ring-1 ring-neutral-700 focus:ring-2 focus:ring-yellow-400 transition"
      />
    </div>
  `
})
export class InputComponent {
  @Input() value: string = '';
  @Input() placeholder: string = '';
  @Input() type: string = 'text';
  @Output() valueChange = new EventEmitter<string>();

  onInput(ev: Event) {
    const target = ev.target as HTMLInputElement;
    this.valueChange.emit(target.value);
  }
}

@Component({
  selector: 'app-ai-message',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div [ngClass]="containerClass">
      <div [ngClass]="bubbleClass">
        <ng-content></ng-content>
      </div>
    </div>
  `
})
export class AiMessageComponent {
  @Input() isBot: boolean = true;

  get containerClass(): string {
    return classNames('w-full flex mb-3', this.isBot ? 'justify-start' : 'justify-end');
  }

  get bubbleClass(): string {
    return this.isBot
      ? 'max-w-[85%] bg-neutral-800 text-gray-100 rounded-2xl px-4 py-3 ring-1 ring-white/10'
      : 'max-w-[85%] bg-yellow-400 text-black rounded-2xl px-4 py-3 ring-1 ring-yellow-300';
  }
}

// ---- AI Modal Component ----
interface ChatState {
  isOpen: boolean;
  step: 'start' | 'faqs' | 'results';
  category: ServiceCategoryId;
  problem: string;
  faqIndex: number;
  answers: Record<string, string | boolean>;
  ranked: WorkerProfile[]; // Top ranked
}

@Component({
  selector: 'app-ai-modal',
  standalone: true,
  imports: [CommonModule, CardComponent, InputComponent, AiMessageComponent],
  template: `
    @if (state().isOpen) {
      <div class="fixed inset-0 z-50 flex">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/60" (click)="close()"></div>
        <!-- Panel -->
        <div class="relative ml-auto w-full md:w-[520px] h-full bg-neutral-950/95 backdrop-blur-xl border-l border-white/10 flex flex-col">
          <div class="p-4 border-b border-white/10 flex items-center justify-between">
            <div class="flex items-center gap-2 text-white">
              <span class="text-xl">🤖</span>
              <div class="font-semibold">Handy AI Assistant</div>
            </div>
            <button (click)="close()" class="px-3 py-1.5 rounded-lg bg-neutral-800 text-gray-200 hover:bg-neutral-700">Close</button>
          </div>

          <div class="flex-1 overflow-y-auto p-4 space-y-3">
            <!-- Conversation -->
            <app-ai-message [isBot]="true">
              <div class="font-semibold text-yellow-300">Welcome!</div>
              <div>I'm here to match you with the perfect helper.</div>
            </app-ai-message>

            @if (state().step === 'start') {
              <app-ai-message [isBot]="true">
                <div>What issue are you experiencing today?</div>
              </app-ai-message>
              <div class="mt-2">
                <app-input [value]="draftProblem()" placeholder="Describe your problem..." (valueChange)="draftProblem.set($event)"></app-input>
                <div class="mt-3 flex justify-end">
                  <button (click)="submitProblem()" class="px-4 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300">Continue</button>
                </div>
              </div>
            }

            @if (state().step === 'faqs') {
              <app-ai-message [isBot]="true">
                <div class="text-yellow-300 font-semibold">Category:</div>
                <div class="mt-1">{{ categoryDef().title }} <span class="ml-2">{{ categoryDef().icon }}</span></div>
              </app-ai-message>

              <div class="text-sm text-gray-300">Please answer a few quick questions to improve the match.</div>

              <div class="mt-2">
                <app-card [hover]="false" padding="p-3">
                  <div class="text-sm text-gray-600">Question {{ state().faqIndex + 1 }} of {{ faqs().length }}</div>
                  <div class="mt-1 font-medium">{{ currentFaq().question }}</div>

                  @if (currentFaq().type === 'text') {
                    <div class="mt-2">
                      <app-input [value]="currentAnswerText()" placeholder="Type your answer..." (valueChange)="currentAnswerText.set($event)"></app-input>
                    </div>
                  } @else if (currentFaq().type === 'boolean') {
                    <div class="mt-3 flex gap-2">
                      <button (click)="answerBoolean(true)" class="px-4 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300">Yes</button>
                      <button (click)="answerBoolean(false)" class="px-4 py-2 rounded-lg bg-neutral-200 text-neutral-900 hover:bg-white">No</button>
                    </div>
                  } @else if (currentFaq().type === 'select') {
                    <div class="mt-3 grid grid-cols-2 gap-2">
                      @for (opt of currentFaq().options ?? []; track $index) {
                        <button (click)="answerSelect(opt)" class="px-3 py-2 rounded-lg bg-neutral-200 text-neutral-900 hover:bg-white">{{ opt }}</button>
                      }
                    </div>
                  }

                  <div class="mt-4 flex justify-between">
                    <button (click)="prevFaq()" [disabled]="state().faqIndex === 0" class="px-3 py-2 rounded-lg bg-neutral-200 text-neutral-900 disabled:opacity-50">Back</button>
                    <button (click)="nextFaq()" class="px-3 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300">Next</button>
                  </div>
                </app-card>
              </div>
            }

            @if (state().step === 'results') {
              <app-ai-message [isBot]="true">
                <div class="text-yellow-300 font-semibold">Top Matches</div>
                <div>Based on your needs, here are your best options:</div>
              </app-ai-message>

              <div class="space-y-3">
                @for (w of state().ranked; track w.id) {
                  <app-card>
                    <div class="flex items-center justify-between">
                      <div>
                        <div class="text-lg font-bold flex items-center gap-2">
                          <span class="text-yellow-500">#{{ $index + 1 }}</span>
                          <span>{{ w.name }}</span>
                        </div>
                        <div class="text-sm text-gray-600">{{ w.specialty }} • {{ w.rating.toFixed(1) }}★ • ${{ w.hourlyRate }}/hr</div>
                        <div class="text-xs text-gray-500 mt-1">Skills: {{ w.skills.join(', ') }}</div>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="px-2 py-1 rounded-full text-xs" [ngClass]="w.available ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'">{{ w.available ? 'Available' : 'Offline' }}</span>
                        <button (click)="book(w)" class="px-3 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300">Book Now</button>
                      </div>
                    </div>
                  </app-card>
                }
              </div>
            }
          </div>
        </div>
      </div>
    }
  `
})
export class AiModalComponent {
  private fb = inject(FirebaseService);

  @Input() isOpen: boolean = false;
  @Output() closed = new EventEmitter<void>();

  readonly state = signal<ChatState>({
    isOpen: false,
    step: 'start',
    category: 'General',
    problem: '',
    faqIndex: 0,
    answers: {},
    ranked: [],
  });

  readonly draftProblem = signal<string>('');

  readonly categoryDef = computed(() => CATEGORY_BY_ID[this.state().category]);
  readonly faqs = computed(() => this.categoryDef().faqs);
  readonly currentFaq = computed(() => this.faqs()[this.state().faqIndex] ?? this.faqs()[0]);
  readonly currentAnswerText = signal<string>('');

  ngOnChanges() {
    if (this.isOpen) {
      this.state.set({
        isOpen: true,
        step: 'start',
        category: 'General',
        problem: '',
        faqIndex: 0,
        answers: {},
        ranked: [],
      });
      this.draftProblem.set('');
      this.currentAnswerText.set('');
    }
  }

  close() {
    this.state.update((s) => ({ ...s, isOpen: false }));
    this.closed.emit();
  }

  private detectCategory(text: string): ServiceCategoryId {
    const lower = text.toLowerCase();
    let best: { id: ServiceCategoryId; score: number } = { id: 'General', score: 0 };
    for (const c of CATEGORY_DEFS) {
      const score = c.keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
      if (score > best.score) best = { id: c.id, score } as any;
    }
    return best.score > 0 ? best.id : 'General';
  }

  submitProblem() {
    const prob = this.draftProblem().trim();
    const cat = this.detectCategory(prob);
    this.state.update((s) => ({ ...s, step: 'faqs', problem: prob, category: cat, faqIndex: 0, answers: {} }));
    this.currentAnswerText.set('');
  }

  answerBoolean(v: boolean) {
    const fid = this.currentFaq().id;
    this.state.update((s) => ({ ...s, answers: { ...s.answers, [fid]: v } }));
  }
  answerSelect(v: string) {
    const fid = this.currentFaq().id;
    this.state.update((s) => ({ ...s, answers: { ...s.answers, [fid]: v } }));
  }

  prevFaq() {
    this.state.update((s) => ({ ...s, faqIndex: Math.max(0, s.faqIndex - 1) }));
  }
  nextFaq() {
    const faq = this.currentFaq();
    if (faq.type === 'text' && this.currentAnswerText().trim()) {
      const fid = faq.id;
      this.state.update((s) => ({ ...s, answers: { ...s.answers, [fid]: this.currentAnswerText().trim() } }));
      this.currentAnswerText.set('');
    }

    if (this.state().faqIndex < this.faqs().length - 1) {
      this.state.update((s) => ({ ...s, faqIndex: s.faqIndex + 1 }));
    } else {
      // Compute ranking
      const ranked = this.rankWorkers();
      this.state.update((s) => ({ ...s, step: 'results', ranked }));
    }
  }

  private rankWorkers(): WorkerProfile[] {
    const workers = this.fb.allWorkers();
    const s = this.state();
    const keywords: string[] = [
      ...CATEGORY_BY_ID[s.category].keywords,
      ...Object.values(s.answers).flatMap((v) => typeof v === 'string' ? v.toLowerCase().split(/\W+/) : [])
    ];

    function scoreWorker(w: WorkerProfile): number {
      const skillMatch = w.skills.reduce((acc, sk) => acc + (keywords.includes(sk.toLowerCase()) ? 1 : 0), 0);
      const specialtyBoost = (w.specialty === s.category) ? 2 : 0;
      const ratingScore = w.rating; // 0..5
      const availabilityBonus = w.available ? 2 : 0;
      // Simple composite score
      return skillMatch * 3 + specialtyBoost + ratingScore * 1.2 + availabilityBonus;
    }

    const ranked = [...workers]
      .map((w) => ({ w, sc: scoreWorker(w) }))
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 3)
      .map((x) => x.w);

    return ranked;
  }

  book(worker: WorkerProfile) {
    const s = this.state();
    const description = [s.problem, ...Object.entries(s.answers).map(([k, v]) => `${k}: ${String(v)}`)].join(' | ');
    this.fb.createJobForWorker(worker, s.category, description);
    // Give feedback and close
    this.close();
  }
}

// ---- Root App Component ----
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, CardComponent, InputComponent, AiModalComponent],
  template: `
    <div class="min-h-screen flex flex-col" [style.background]="radialBg">
      <!-- Header / Auth -->
      <div class="px-4 py-4 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-9 h-9 rounded-xl bg-yellow-400 flex items-center justify-center text-black font-extrabold shadow">H</div>
          <div class="text-white text-xl font-bold">Need A Hand?</div>
        </div>
        <div class="flex items-center gap-3">
          @if (fb.currentFirebaseUser()) {
            <span class="text-xs text-gray-300">UID: {{ fb.currentFirebaseUser()?.uid }}</span>
            <button (click)="fb.signOut()" class="px-3 py-1.5 rounded-lg bg-neutral-800 text-gray-200 hover:bg-neutral-700">Sign Out</button>
          }
        </div>
      </div>

      <!-- Loading State -->
      @if (fb.isInitializing()) {
        <div class="flex-1 flex flex-col items-center justify-center text-gray-300">
          <div class="w-12 h-12 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin"></div>
          <div class="mt-3">Initializing...</div>
        </div>
      } @else {
        <!-- Auth + Role Setup -->
        @if (!fb.userProfile()) {
          <div class="flex-1 flex items-center justify-center p-4">
            <div class="max-w-md w-full space-y-4">
              <app-card>
                <div class="text-xl font-bold">Welcome</div>
                <div class="text-gray-600">Sign in as a Customer or Worker to continue.</div>
                <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button (click)="fb.signInAsCustomer()" class="px-4 py-3 rounded-xl bg-yellow-400 text-black font-semibold hover:bg-yellow-300">Sign In (Customer)</button>
                  <button (click)="fb.signInAsWorker()" class="px-4 py-3 rounded-xl bg-yellow-400 text-black font-semibold hover:bg-yellow-300">Sign In (Worker)</button>
                </div>
              </app-card>

              <app-card>
                <div class="text-sm text-gray-600">Tip</div>
                <div class="text-gray-700">If a custom token is provided via <code class="bg-gray-200 px-1 rounded">window.__initial_auth_token</code>, you'll auto-auth and can choose a role here to create your profile.</div>
              </app-card>
            </div>
          </div>
        } @else {
          <!-- Main Content -->
          <div class="flex-1 p-4">
            @if (isCustomer()) { <!-- Customer Views -->
              @if (currentTab() === 'Workers') {
                <div class="space-y-4">
                  <!-- Categories & AI CTA -->
                  <div class="flex items-center justify-between">
                    <div class="text-white/90 font-semibold">Service Categories</div>
                    <button (click)="openAi()" class="px-3 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300">Start with Handy AI</button>
                  </div>
                  <div class="w-full overflow-x-auto no-scrollbar">
                    <div class="flex gap-3 min-w-max">
                      @for (c of categories; track c.id) {
                        <div class="flex flex-col items-center text-white/90">
                          <div class="w-14 h-14 rounded-2xl flex items-center justify-center ring-1 ring-white/20 bg-transparent text-yellow-400 text-2xl">{{ c.icon }}</div>
                          <div class="text-xs mt-1">{{ c.title }}</div>
                        </div>
                      }
                    </div>
                  </div>

                  <div class="text-white/90 font-semibold">Available Workers Near You</div>
                  <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    @for (w of availableWorkers(); track w.id) {
                      <app-card>
                        <div class="flex items-start justify-between">
                          <div>
                            <div class="text-lg font-bold">{{ w.name }}</div>
                            <div class="text-sm text-gray-600">{{ w.specialty }} • {{ w.rating.toFixed(1) }}★ • ${{ w.hourlyRate }}/hr</div>
                            <div class="text-xs text-gray-500 mt-1">Jobs completed: {{ w.jobsCompleted }}</div>
                          </div>
                          <div class="flex items-center gap-2">
                            <span class="px-2 py-1 rounded-full text-xs" [ngClass]="w.available ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'">{{ w.available ? 'Available' : 'Offline' }}</span>
                            <button (click)="quickBook(w)" class="px-3 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300">Book</button>
                          </div>
                        </div>
                      </app-card>
                    }
                  </div>
                </div>
              } @else if (currentTab() === 'Hired') {
                <div class="space-y-3">
                  <div class="text-white/90 font-semibold">My Jobs</div>
                  @if (fb.myJobsAsCustomer().length === 0) {
                    <div class="text-gray-400">No jobs yet.</div>
                  }
                  @for (j of fb.myJobsAsCustomer(); track j.id) {
                    <app-card>
                      <div class="flex items-start justify-between">
                        <div>
                          <div class="font-bold">{{ j.category }}</div>
                          <div class="text-sm text-gray-600">{{ j.description }}</div>
                        </div>
                        <div class="flex items-center gap-2">
                          <span class="px-2 py-1 rounded-full text-xs" [ngClass]="statusPill(j.status)">{{ j.status }}</span>
                          @if (j.status === 'Pending') {
                            <button (click)="fb.cancelJob(j.id)" class="px-3 py-2 rounded-lg bg-neutral-200 text-neutral-900 hover:bg-white">Cancel</button>
                          }
                        </div>
                      </div>
                    </app-card>
                  }
                </div>
              } @else if (currentTab() === 'Profile') {
                <div class="max-w-xl mx-auto">
                  <app-card>
                    <div class="text-xl font-bold">Customer Profile</div>
                    <div class="mt-2 text-gray-600">Name: {{ (fb.userProfile() as any)?.name }}</div>
                    <div class="text-gray-600">Location: {{ (fb.userProfile() as any)?.location }}</div>
                  </app-card>
                </div>
              }
            } @else { <!-- Worker Views -->
              @if (currentTab() === 'Jobs') {
                <div class="space-y-4">
                  <app-card>
                    <div class="flex items-center justify-between">
                      <div class="font-semibold">Availability</div>
                      <div class="flex items-center gap-2">
                        <span class="px-2 py-1 rounded-full text-xs" [ngClass]="(fb.userProfile() as any)?.available ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'">{{ (fb.userProfile() as any)?.available ? 'Available' : 'Offline' }}</span>
                        <button (click)="toggleAvailability()" class="px-3 py-2 rounded-lg" [ngClass]="(fb.userProfile() as any)?.available ? 'bg-neutral-200 text-neutral-900 hover:bg-white' : 'bg-yellow-400 text-black font-semibold hover:bg-yellow-300'">
                          {{ (fb.userProfile() as any)?.available ? 'Go Offline' : 'Go Available' }}
                        </button>
                      </div>
                    </div>
                  </app-card>

                  <div class="text-white/90 font-semibold">Pending Job Requests</div>
                  @if (pendingWorkerJobs().length === 0) {
                    <div class="text-gray-400">No pending jobs right now.</div>
                  }
                  <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    @for (j of pendingWorkerJobs(); track j.id) {
                      <app-card>
                        <div class="flex items-start justify-between">
                          <div>
                            <div class="font-bold">{{ j.category }}</div>
                            <div class="text-sm text-gray-600">{{ j.description }}</div>
                          </div>
                          <div class="flex items-center gap-2">
                            <span class="px-2 py-1 rounded-full text-xs" [ngClass]="statusPill(j.status)">{{ j.status }}</span>
                            <button (click)="fb.acceptJob(j.id)" class="px-3 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300">Accept</button>
                          </div>
                        </div>
                      </app-card>
                    }
                  </div>
                </div>
              } @else if (currentTab() === 'Earnings') {
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <app-card>
                    <div class="font-bold">Earnings Summary</div>
                    <div class="text-gray-600">This week: ${{ earningsSummary().week }}</div>
                    <div class="text-gray-600">This month: ${{ earningsSummary().month }}</div>
                  </app-card>
                  <app-card>
                    <div class="font-bold">Payout History</div>
                    <div class="text-gray-600">No payouts yet (demo).</div>
                  </app-card>
                </div>
              } @else if (currentTab() === 'Profile') {
                <div class="max-w-xl mx-auto">
                  <app-card>
                    <div class="text-xl font-bold">Worker Profile</div>
                    <div class="mt-2 text-gray-600">Name: {{ (fb.userProfile() as any)?.name }}</div>
                    <div class="text-gray-600">Specialty: {{ (fb.userProfile() as any)?.specialty }}</div>
                    <div class="text-gray-600">Rating: {{ (fb.userProfile() as any)?.rating?.toFixed?.(1) }}★</div>
                    <div class="text-gray-600">Hourly Rate: ${{ (fb.userProfile() as any)?.hourlyRate }}/hr</div>
                    <div class="text-gray-600">Skills: {{ (fb.userProfile() as any)?.skills?.join(', ') }}</div>
                  </app-card>
                </div>
              }
            }
          </div>

          <!-- Bottom Navigation -->
          <div class="sticky bottom-0 w-full backdrop-blur bg-neutral-950/80 border-t border-white/10">
            <div class="max-w-4xl mx-auto">
              <div class="flex items-stretch justify-around">
                @for (t of visibleTabs(); track t) {
                  <button (click)="setTab(t)" class="flex-1 py-3 text-sm font-semibold border-b-2" [ngClass]="tabClass(t)">{{ t }}</button>
                }
              </div>
            </div>
          </div>

          <!-- AI Button only for Customer -->
          @if (isCustomer()) {
            <button (click)="openAi()" class="fixed bottom-20 right-4 md:right-6 w-14 h-14 rounded-full bg-yellow-400 text-black text-2xl shadow-xl hover:scale-105 transition">💬</button>
          }

          <!-- AI Modal -->
          @if (aiOpen()) {
            <app-ai-modal [isOpen]="true" (closed)="aiOpen.set(false)"></app-ai-modal>
          }
        }
      }
    </div>
  `
})
export class AppComponent implements OnInit {
  fb = inject(FirebaseService);

  readonly radialBg = 'radial-gradient(ellipse at center, #141726 0%, #0a0c13 60%, #06070c 100%)';

  // Tabs per role
  readonly customerTabs = ['Workers', 'Hired', 'Profile'] as const;
  readonly workerTabs = ['Jobs', 'Earnings', 'Profile'] as const;
  readonly currentTab = signal<string>('Workers');

  readonly aiOpen = signal<boolean>(false);

  readonly isCustomer = computed(() => this.fb.userProfile()?.role === 'Customer');
  readonly isWorker = computed(() => this.fb.userProfile()?.role === 'Worker');

  readonly categories = CATEGORY_DEFS;

  ngOnInit(): void {
    // Keep tab consistent with role
    effect(() => {
      const up = this.fb.userProfile();
      if (!up) return;
      if (up.role === 'Customer' && !this.customerTabs.includes(this.currentTab() as any)) {
        this.currentTab.set('Workers');
      }
      if (up.role === 'Worker' && !this.workerTabs.includes(this.currentTab() as any)) {
        this.currentTab.set('Jobs');
      }
    });
  }

  visibleTabs = computed(() => this.isCustomer() ? this.customerTabs : this.workerTabs);

  setTab(t: string) { this.currentTab.set(t); }

  tabClass(t: string): string {
    const isActive = this.currentTab() === t;
    return classNames(
      'text-center',
      isActive ? 'text-yellow-400 border-yellow-400' : 'text-gray-400 border-transparent hover:text-white hover:border-white/30'
    );
  }

  statusPill(status: JobStatus): string {
    switch (status) {
      case 'Pending': return 'bg-yellow-100 text-yellow-800';
      case 'Accepted': return 'bg-blue-100 text-blue-800';
      case 'Completed': return 'bg-green-100 text-green-800';
      case 'Canceled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }

  availableWorkers = computed(() => this.fb.allWorkers().filter((w) => w.available));

  quickBook(w: WorkerProfile) {
    // Simple description for quick booking
    this.fb.createJobForWorker(w, (w.specialty as ServiceCategoryId) || 'General', `Quick booking for ${w.specialty}`);
  }

  pendingWorkerJobs = computed(() => this.fb.myJobsAsWorker().filter((j) => j.status === 'Pending'));

  earningsSummary = computed(() => {
    // Placeholder demo numbers
    const accepted = this.fb.myJobsAsWorker().filter((j) => j.status === 'Accepted').length;
    const base = accepted * 75;
    return { week: base, month: base * 4 };
  });

  openAi() { this.aiOpen.set(true); }
  toggleAvailability() {
    const up = this.fb.userProfile();
    if (up && up.role === 'Worker') {
      this.fb.setWorkerAvailability(!up.available);
    }
  }
}

// ---- Bootstrap the application ----
bootstrapApplication(AppComponent, {
  providers: [
    // CommonModule is imported in components, no global providers needed.
  ]
}).catch(err => console.error(err));
