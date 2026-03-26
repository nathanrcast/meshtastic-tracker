from pydantic import BaseModel, Field


class NodeResponse(BaseModel):
    node_id: str
    long_name: str
    short_name: str
    hardware_model: str
    battery_level: int | None
    voltage: float | None
    snr: float | None
    lat: float | None
    lon: float | None
    altitude: int | None
    last_heard: str | None
    is_online: bool
    is_tracked: bool

    class Config:
        from_attributes = True


class TrackNodeRequest(BaseModel):
    is_tracked: bool


class PositionResponse(BaseModel):
    lat: float
    lon: float
    altitude: int | None
    timestamp: str

    class Config:
        from_attributes = True


class ReactionResponse(BaseModel):
    from_id: str
    emoji: str


class MessageResponse(BaseModel):
    id: int
    from_id: str
    from_name: str | None = None
    to_id: str
    channel: int
    text: str
    packet_id: int | None = None
    snr: float | None = None
    rssi: int | None = None
    timestamp: str
    reactions: list[ReactionResponse] = []

    class Config:
        from_attributes = True


class SendMessage(BaseModel):
    text: str = Field(min_length=1, max_length=228)
    channel: int = Field(default=0, ge=0, le=255)
    to_id: str | None = Field(default=None, max_length=20)


class SendReaction(BaseModel):
    emoji: str = Field(min_length=1, max_length=4)
    channel: int = Field(default=0, ge=0, le=255)


class CreateGeofence(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    radius_m: int = Field(ge=50, le=100000)


class UpdateGeofence(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    radius_m: int | None = Field(default=None, ge=50, le=100000)
    enabled: bool | None = None


class HealthResponse(BaseModel):
    connected: bool
    node_count: int
    message_count: int
    my_node_id: str | None = None
    auth_required: bool = False
