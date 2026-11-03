'use client';
import { Shell } from '../../components/Shell';
import { AgentsPanel } from '../../components/operators/AgentsPanel';
import { ORG_NAV } from '../nav';

/**
 * «نمایندگان بیمه» (insurer admin, panel 2): the insurer's own insurance agents — panel-1 users who sign in
 * at «ورود برای بارگذاری مدارک › نماینده بیمه». The insurer's own staff are in «کاربران و نقش‌ها».
 */
export default function Agents() {
  return (
    <Shell title="نمایندگان بیمه" subtitle="کاربران پنل ۱: نمایندگان بیمه، هر یک وابسته به یک شعبه" nav={ORG_NAV} realm="org">
      <AgentsPanel realm="org" base="" />
    </Shell>
  );
}
