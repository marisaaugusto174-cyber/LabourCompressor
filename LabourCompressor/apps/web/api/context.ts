import { type createRuntimeTaskService } from '../task-service.ts';
import { type TagVisionLauncher } from '../tagvision-launcher.ts';

export interface WebApiContext {
  readonly webHost: string;
  readonly webPort: number;
  readonly publicDir: string;
  readonly defaultMasterSpreadsheet: string;
  readonly defaultProviderConfig: string;
  readonly defaultPlatformCredentialConfig: string;
  readonly defaultCacheRoot: string;
  readonly uploadsDir: string;
  readonly taskService: ReturnType<typeof createRuntimeTaskService>;
  readonly tagVisionLauncher: TagVisionLauncher;
}
