#!/bin/bash

set -e

check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo "Erro: $1 nao está instalado ou nao foi encontrado no PATH."
        exit 1
    fi
}

echo "# Validando requisitos..."
check_command "aws"
check_command "docker"

ENV=${1:-dev}
CONFIG_FILE="terraform/envs/${ENV}/config.yaml"

echo "# Ambiente selecionado: $ENV"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Erro: Arquivo de configuracao para o ambiente '$ENV' nao encontrado em $CONFIG_FILE"
    echo "Ambientes disponiveis: $(ls terraform/envs | sed 's/.yaml//g')"
    exit 1
fi

get_config() {
    grep "^$1:" "$CONFIG_FILE" | awk -F': ' '{print $2}' | tr -d '"' | tr -d "'" | xargs
}

AWS_REGION=$(get_config "aws_region")
APP_NAME=$(get_config "app_name")
APP_NAME="${ENV}-${APP_NAME}"
IMAGE_TAG="latest"
if command -v git &> /dev/null; then
    IMAGE_TAG=$(git rev-parse --short HEAD 2>/dev/null || IMAGE_TAG)
fi

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text | xargs)
REGISTRY_URL="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
ECR_REPO_NAME=$APP_NAME
CLUSTER_NAME="$APP_NAME-cluster"
SERVICE_NAME="$APP_NAME-service"
FULL_IMAGE_NAME="$REGISTRY_URL/$ECR_REPO_NAME"

echo "# --- ETAPA 1: DOCKER BUILD & PUSH ---"
echo "# Autenticando no Amazon ECR ($REGISTRY_URL)..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $REGISTRY_URL

echo "# Construindo imagem Docker..."
docker build --provenance=false -t $ECR_REPO_NAME .

echo "# Tagging e enviando para o ECR ($IMAGE_TAG e latest)..."
docker tag $ECR_REPO_NAME:latest $FULL_IMAGE_NAME:$IMAGE_TAG
docker tag $ECR_REPO_NAME:latest $FULL_IMAGE_NAME:latest

echo "# Realizando push das tags específicas..."
docker push $FULL_IMAGE_NAME:$IMAGE_TAG
docker push $FULL_IMAGE_NAME:latest

echo "# --- ETAPA 2: ATUALIZANDO TASK DEFINITION ---"
echo "# Obtendo definicao atual da Task ($APP_NAME-task)..."
TASK_DEF_JSON=$(aws ecs describe-task-definition --task-definition "$APP_NAME-task" --region $AWS_REGION)

echo "# Gerando nova revisao com imagem: $IMAGE_TAG..."
NEW_TASK_DEF=$(echo "$TASK_DEF_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
container_defs = data['taskDefinition']['containerDefinitions']

container_defs[0]['image'] = '$FULL_IMAGE_NAME:$IMAGE_TAG'

output = {
    'family': data['taskDefinition']['family'],
    'containerDefinitions': container_defs,
    'volumes': data['taskDefinition'].get('volumes', []),
    'networkMode': data['taskDefinition'].get('networkMode'),
    'placementConstraints': data['taskDefinition'].get('placementConstraints', []),
    'requiresCompatibilities': data['taskDefinition'].get('requiresCompatibilities', []),
    'cpu': data['taskDefinition'].get('cpu'),
    'memory': data['taskDefinition'].get('memory'),
    'taskRoleArn': data['taskDefinition'].get('taskRoleArn'),
    'executionRoleArn': data['taskDefinition'].get('executionRoleArn'),
    'runtimePlatform': data['taskDefinition'].get('runtimePlatform')
}
# Remove None values
output = {k: v for k, v in output.items() if v is not None}
print(json.dumps(output))
")

NEW_TD_ARN=$(aws ecs register-task-definition --region $AWS_REGION --cli-input-json "$NEW_TASK_DEF" --query 'taskDefinition.taskDefinitionArn' --output text)
echo "# Nova revisao registrada: $NEW_TD_ARN"

echo "# --- ETAPA 3: ECS UPDATE SERVICE ---"
echo "# Atualizando servico $SERVICE_NAME para revisao $NEW_TD_ARN..."
aws ecs update-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --task-definition "$NEW_TD_ARN" --desired-count 1 --force-new-deployment --region $AWS_REGION

echo "# Deploy de $APP_NAME finalizado com sucesso!"
