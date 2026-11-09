-- Alborz: each نوع پرونده gets its own «علت» list (the user's lists of 2026-11-09); «علت فوت» in عمر.
-- Types the insurer added itself are kept after the standard seven.
UPDATE "Tenant"
SET "workflowModel" = jsonb_set(
  jsonb_set(
    jsonb_set(COALESCE("workflowModel", '{}'::jsonb), '{form}', COALESCE("workflowModel"->'form', '{}'::jsonb), true),
    '{form,caseTypes}',
    '[{"code": "DEATH_ILLNESS", "label": "فوت به هر علت", "causeGroup": "DEATH", "death": true, "causes": ["بیماری", "سرطان", "سکته قلبی بدون برگه ذینفع", "فوت-عدم تعیین سهم ذینفعها و پرداخت در وجه وراث", "انفجار", "سکته قلبی-پرداخت در وجه وکیل یا وراث", "سکته قلبی-پرداخت در وجه بیمه گذار", "سکته مغزی-پرداخت در وجه بیمه گذار", "فوت در اثر حادثه-پرداخت در وجه \"وکیل یا وراث\"", "فوت در اثر حادثه-پرداخت در وجه \"وراث قانونی\"", "سکته قلبی با برگه ذینفع", "سکته مغزی با برگه ذینفع", "فوت در اثر حادثه با برگه ذینفع", "بیماری کرونا", "بیماری های تنفسی", "فوت در اثر حادثه-ذینفع \"بیمه گذار\""]}, {"code": "DISABILITY_ILLNESS", "label": "از کار افتادگی دائم و کامل ناشی از بیماری", "causeGroup": "DEATH", "death": false, "causes": ["ازکارافتادگی کلی ناشی از بیماری با رأی کمیسیون پزشکی تأمین اجتماعی و تائید بیمه البرز", "ازکارافتادگی کلی ناشی از بیماری با رأی کمیسیون پزشکی بیمه گذار"]}, {"code": "DEATH_ACCIDENT", "label": "فوت بر اثر حادثه", "causeGroup": "ACCIDENT", "death": true, "causes": ["حادثه ناشی از کار", "حادثه غیر ناشی از کار (تصادف)", "زلزله (با فرم تعیین ذینفع)", "زلزله (بدون فرم تعیین ذینفع)", "جنگ"]}, {"code": "DISABILITY_ACCIDENT", "label": "نقص عضو و از کار افتادگی بر اثر حادثه", "causeGroup": "ACCIDENT", "death": false, "causes": ["حادثه ناشی از کار", "حادثه غیر ناشی از کار (تصادف)", "زلزله (با فرم تعیین ذینفع)", "زلزله (بدون فرم تعیین ذینفع)", "حادثه (با هزینه پزشکی)", "حادثه (بدون هزینه پزشکی)", "جنگ"]}, {"code": "MEDICAL_ACCIDENT", "label": "جبران هزینه‌های پزشکی ناشی از حادثه", "causeGroup": "ACCIDENT", "death": false, "causes": ["حادثه ناشی از کار", "حادثه غیر ناشی از کار (تصادف)", "زلزله (با فرم تعیین ذینفع)", "زلزله (بدون فرم تعیین ذینفع)", "حادثه (با هزینه پزشکی)", "حادثه (بدون هزینه پزشکی)", "جنگ"]}, {"code": "DAILY_GENERAL", "label": "غرامت روزانه عمومی", "causeGroup": "ACCIDENT", "death": false, "causes": []}, {"code": "DAILY_HOSPITAL", "label": "غرامت روزانه بیمارستانی", "causeGroup": "ACCIDENT", "death": false, "causes": []}]'::jsonb || COALESCE((
      SELECT jsonb_agg(t) FROM jsonb_array_elements(COALESCE("workflowModel"->'form'->'caseTypes', '[]'::jsonb)) t
      WHERE t->>'code' NOT IN ('DEATH_ILLNESS','DISABILITY_ILLNESS','DEATH_ACCIDENT','DISABILITY_ACCIDENT','MEDICAL_ACCIDENT','DAILY_GENERAL','DAILY_HOSPITAL')
    ), '[]'::jsonb),
    true),
  '{form,causeLists,DEATH}', '["بیماری", "سرطان", "سکته قلبی بدون برگه ذینفع", "فوت-عدم تعیین سهم ذینفعها و پرداخت در وجه وراث", "انفجار", "سکته قلبی-پرداخت در وجه وکیل یا وراث", "سکته قلبی-پرداخت در وجه بیمه گذار", "سکته مغزی-پرداخت در وجه بیمه گذار", "فوت در اثر حادثه-پرداخت در وجه \"وکیل یا وراث\"", "فوت در اثر حادثه-پرداخت در وجه \"وراث قانونی\"", "سکته قلبی با برگه ذینفع", "سکته مغزی با برگه ذینفع", "فوت در اثر حادثه با برگه ذینفع", "بیماری کرونا", "بیماری های تنفسی", "فوت در اثر حادثه-ذینفع \"بیمه گذار\""]'::jsonb, true)
WHERE slug = 'alborz';

UPDATE "Tenant" SET "workflowModel" = jsonb_set("workflowModel", '{form,lines,LIFE,causeLabel}', '"علت فوت"'::jsonb, true)
WHERE slug = 'alborz' AND "workflowModel"->'form'->'lines' ? 'LIFE';

-- Panel 1 of Alborz and Damuon: no «مسئولیت» and no «عمر پس‌انداز».
UPDATE "Tenant" SET "policyKinds" = ARRAY['LIFE','ACCIDENT','CREDIT_LIFE']::text[]
WHERE slug IN ('alborz', 'damuon');
