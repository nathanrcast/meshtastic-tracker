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


class MessageResponse(BaseModel):
    id: int
    from_id: str
    from_name: str | None = None
    to_id: str
    channel: int
    text: str
    snr: float | None = None
    rssi: int | None = None
    timestamp: str

    class Config:
        from_attributes = True


class SendMessage(BaseModel):
    text: str = Field(min_length=1, max_length=228)
    channel: int = 0


class HealthResponse(BaseModel):
    connected: bool
    meshtastic_host: str
    node_count: int
    message_count: int
    my_node_id: str | None = None
