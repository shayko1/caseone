import { useState } from "react";
import { submissions } from "@wix/forms";

// Live form seeded by scripts/seed-form.sh (Task 6) — see
// caseone/seed-artifacts/form.json. Field shape (target/required/identifier)
// is hardcoded here rather than fetched via forms.listForms() because the
// form is fixed and known at build time; this keeps the island free of an
// extra SSR round-trip. `identifier: "TEXT_AREA"` is what tells us to render
// project_details as a <textarea> — see CONTACT_FORM.md's naming-trap note:
// componentType is always "TEXT_INPUT" for both single-line and paragraph
// fields, so it can't be used to distinguish them.
const FORM_ID = "b9ab85e6-fc3d-4b66-8b4f-48a8c551ca39";

interface FormFieldConfig {
	label: string;
	target: string;
	required: boolean;
	identifier: string;
}

const FORM_FIELDS: FormFieldConfig[] = [
	{ label: "Name", target: "name", required: true, identifier: "CONTACTS_FIRST_NAME" },
	{ label: "Email", target: "email", required: true, identifier: "CONTACTS_EMAIL" },
	{ label: "Company", target: "company", required: false, identifier: "CONTACTS_COMPANY" },
	{
		label: "What do you want to build?",
		target: "project_details",
		required: false,
		identifier: "TEXT_AREA",
	},
];

type Status = "idle" | "submitting" | "success" | "error";

export default function ContactForm() {
	const [formData, setFormData] = useState<Record<string, string>>({});
	const [status, setStatus] = useState<Status>("idle");
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	const setValue = (target: string, value: string) => {
		setFormData((prev) => ({ ...prev, [target]: value }));
	};

	const validate = (): boolean => {
		const errors: Record<string, string> = {};
		for (const field of FORM_FIELDS) {
			if (field.required && !formData[field.target]?.trim()) {
				errors[field.target] = `${field.label} is required.`;
			}
		}
		if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
			errors.email = "Enter a valid email address.";
		}
		setFieldErrors(errors);
		return Object.keys(errors).length === 0;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!validate()) return;

		setStatus("submitting");
		try {
			const result = await submissions.createSubmission({
				formId: FORM_ID,
				submissions: formData,
			});

			if (result.status === "PENDING" || result.status === "CONFIRMED") {
				setStatus("success");
				setFormData({});
			} else {
				setStatus("error");
			}
		} catch (err: unknown) {
			const violations = (err as any)?.details?.validationError?.fieldViolations ?? [];
			const errorMap: Record<string, string> = {};
			for (const violation of violations) {
				const fieldErrs: { errorPath?: string; errorMessage?: string }[] = violation?.data?.errors ?? [];
				for (const fe of fieldErrs) {
					if (fe.errorPath && !errorMap[fe.errorPath]) {
						errorMap[fe.errorPath] = fe.errorMessage ?? "Invalid value.";
					}
				}
			}
			if (Object.keys(errorMap).length > 0) {
				setFieldErrors(errorMap);
				setStatus("idle");
			} else {
				console.error("[ContactForm] submission failed:", err);
				setStatus("error");
			}
		}
	};

	if (status === "success") {
		return (
			<div className="form-success" role="status">
				Thanks — we'll be in touch.
			</div>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="form-container" noValidate>
			{FORM_FIELDS.map((field) => (
				<div key={field.target} className="form-field">
					<label className="form-label" htmlFor={field.target}>
						{field.label}
						{field.required && <span className="required"> *</span>}
					</label>
					{field.identifier === "TEXT_AREA" ? (
						<textarea
							id={field.target}
							required={field.required}
							value={formData[field.target] ?? ""}
							onChange={(e) => setValue(field.target, e.target.value)}
							rows={4}
							className={`form-textarea${fieldErrors[field.target] ? " form-input-error" : ""}`}
						/>
					) : (
						<input
							id={field.target}
							type={field.target === "email" ? "email" : "text"}
							required={field.required}
							value={formData[field.target] ?? ""}
							onChange={(e) => setValue(field.target, e.target.value)}
							className={`form-input${fieldErrors[field.target] ? " form-input-error" : ""}`}
						/>
					)}
					{fieldErrors[field.target] && <p className="form-field-error">{fieldErrors[field.target]}</p>}
				</div>
			))}

			<button type="submit" disabled={status === "submitting"} className="form-button btn-primary">
				{status === "submitting" ? "Sending…" : "Send Inquiry"}
			</button>

			{status === "error" && (
				<p className="form-error">Something went wrong on our end — please try again.</p>
			)}
		</form>
	);
}
