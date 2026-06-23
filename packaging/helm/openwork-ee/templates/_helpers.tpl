{{- define "openwork-ee.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openwork-ee.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "openwork-ee.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openwork-ee.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openwork-ee.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "openwork-ee.labels" -}}
helm.sh/chart: {{ include "openwork-ee.chart" . }}
{{ include "openwork-ee.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "openwork-ee.componentSelectorLabels" -}}
{{ include "openwork-ee.selectorLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "openwork-ee.componentLabels" -}}
{{ include "openwork-ee.labels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "openwork-ee.configName" -}}
{{ include "openwork-ee.fullname" . }}-config
{{- end -}}

{{- define "openwork-ee.secretName" -}}
{{- if .Values.secret.existingSecret -}}
{{- .Values.secret.existingSecret -}}
{{- else -}}
{{- include "openwork-ee.fullname" . }}-secret
{{- end -}}
{{- end -}}

{{- define "openwork-ee.denApiServiceName" -}}
{{ include "openwork-ee.fullname" . }}-den-api
{{- end -}}

{{- define "openwork-ee.denWebServiceName" -}}
{{ include "openwork-ee.fullname" . }}-den-web
{{- end -}}

{{- define "openwork-ee.inferenceServiceName" -}}
{{ include "openwork-ee.fullname" . }}-inference
{{- end -}}

{{- define "openwork-ee.denApiInternalUrl" -}}
{{- default (printf "http://%s:%v" (include "openwork-ee.denApiServiceName" .) .Values.denApi.service.port) .Values.config.internal.apiBaseUrl -}}
{{- end -}}

{{- define "openwork-ee.authFallbackInternalUrl" -}}
{{- default (include "openwork-ee.denApiInternalUrl" .) .Values.config.internal.authFallbackBaseUrl -}}
{{- end -}}

{{- define "openwork-ee.inferenceInternalUrl" -}}
{{- default (printf "http://%s:%v" (include "openwork-ee.inferenceServiceName" .) .Values.inference.service.port) .Values.config.internal.inferenceProxyBaseUrl -}}
{{- end -}}
