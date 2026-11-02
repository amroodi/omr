import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DEFAULT_WORKFLOW_MODEL, modelFrom, Stage, stageLabels, WorkflowModel } from '../claims/workflow';

/**
 * Every insurer's Model View, kept in memory so stage names can be read anywhere without a query
 * (refreshed each minute and on save). Rules that refuse an action use `load`, which reads the database.
 */
@Injectable()
export class ModelStore implements OnModuleInit, OnModuleDestroy {
  private cache = new Map<string, WorkflowModel>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.refresh().catch(() => undefined);
    if (process.env.NODE_ENV !== 'test') this.timer = setInterval(() => this.refresh().catch(() => undefined), 60_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async refresh() {
    const rows = await this.prisma.unscoped().tenant.findMany({ where: { kind: 'INSURER' }, select: { id: true, workflowModel: true } });
    this.cache = new Map(rows.map((r) => [r.id, modelFrom(r.workflowModel)]));
  }

  get(insurerId: string | null | undefined): WorkflowModel {
    return (insurerId && this.cache.get(insurerId)) || DEFAULT_WORKFLOW_MODEL;
  }
  labels(insurerId: string | null | undefined): Record<Stage, string> {
    return stageLabels(this.get(insurerId));
  }
  async load(insurerId: string): Promise<WorkflowModel> {
    const t = await this.prisma.unscoped().tenant.findUnique({ where: { id: insurerId }, select: { workflowModel: true } });
    const m = modelFrom(t?.workflowModel);
    this.cache.set(insurerId, m);
    return m;
  }
}
